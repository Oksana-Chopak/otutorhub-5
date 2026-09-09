DROP POLICY IF EXISTS feedback_select_own_or_manager ON public.feedback_submissions;
CREATE POLICY feedback_select_own_or_manager ON public.feedback_submissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));
DROP POLICY IF EXISTS feedback_update_manager ON public.feedback_submissions;
CREATE POLICY feedback_update_manager ON public.feedback_submissions FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()))
  WITH CHECK ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));
CREATE OR REPLACE FUNCTION public.set_group_enrollment_price(_enrollment_id uuid, _price numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_mgr boolean;
  _group_tutor uuid;
  _tutor_independent boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _price IS NULL OR _price < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;
  SELECT g.tutor_id INTO _group_tutor
  FROM public.group_enrollments e
  JOIN public.lesson_groups g ON g.id = e.group_id
  WHERE e.id = _enrollment_id;
  IF _group_tutor IS NULL THEN RAISE EXCEPTION 'Enrollment not found'; END IF;
  _is_mgr := public.is_hub_manager_of(_group_tutor);
  _tutor_independent := EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = _group_tutor AND ws.independent_workspace = true
  );
  IF NOT (
    (_is_mgr AND NOT _tutor_independent)
    OR (_uid = _group_tutor AND _tutor_independent)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.group_enrollments
     SET price_per_lesson = _price
   WHERE id = _enrollment_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_group_participant_payment(_participant_ids uuid[], _status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_mgr boolean;
  _n integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _status NOT IN ('paid', 'unpaid') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _participant_ids IS NULL OR array_length(_participant_ids, 1) IS NULL THEN RETURN 0; END IF;
  _is_mgr := public.has_role(_uid, 'manager'::app_role);
  UPDATE public.lesson_participants lp
     SET student_payment_status = _status,
         student_paid_at        = CASE WHEN _status = 'paid' THEN now() ELSE NULL END
    FROM public.lessons l
   WHERE lp.id = ANY(_participant_ids)
     AND l.id = lp.lesson_id
     AND (
       (_is_mgr AND (l.source = 'hub' OR l.source IS NULL) AND public.is_hub_scoped(l.tutor_id))
       OR (
         l.tutor_id = _uid
         AND l.source = 'independent'
         AND EXISTS (
           SELECT 1 FROM public.tutor_workspace_settings ws
           WHERE ws.tutor_id = _uid AND ws.independent_workspace = true
         )
       )
     );
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_group_tutor(_group_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id <> auth.uid() AND NOT public.is_hub_manager_of(_user_id) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.lesson_groups g
    WHERE g.id = _group_id AND g.tutor_id = _user_id
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_group_active_student(_group_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id <> auth.uid()
     AND NOT (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(_user_id)) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.group_enrollments ge
    WHERE ge.group_id = _group_id
      AND ge.student_id = _user_id
      AND ge.status = 'active'
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_notification(_user_id uuid, _type text, _title text, _body text DEFAULT NULL::text, _link text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _existing uuid;
  _new_id   uuid;
  _caller   uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _user_id IS NULL OR _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'user_id, type and title are required';
  END IF;
  IF _link IS NOT NULL AND (left(_link, 1) <> '/' OR left(_link, 2) = '//') THEN
    RAISE EXCEPTION 'notification link must be a relative path' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (
    _caller = _user_id
    OR (public.has_role(_caller, 'manager'::app_role) AND public.is_hub_member(_user_id))
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _user_id)
    OR EXISTS (
      SELECT 1 FROM public.hub_managers hm
       WHERE hm.user_id = _user_id
         AND (hm.hub_id = public.hub_of_user(_caller)
              OR EXISTS (SELECT 1 FROM public.hub_members m
                          WHERE m.user_id = _caller AND m.hub_id = hm.hub_id))
    )
    OR EXISTS (
      SELECT 1 FROM public.student_rates r
      WHERE (r.tutor_id = _caller AND r.student_id = _user_id)
         OR (r.student_id = _caller AND r.tutor_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE (l.tutor_id = _caller AND l.student_id = _user_id)
         OR (l.student_id = _caller AND l.tutor_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.lesson_groups g
      JOIN public.group_enrollments ge ON ge.group_id = g.id
      WHERE g.tutor_id = _caller AND ge.student_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE (t.tutor_id = _caller AND t.student_id = _user_id)
         OR (t.student_id = _caller AND t.tutor_id = _user_id)
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to notify this user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id INTO _existing
    FROM public.notifications
   WHERE user_id = _user_id
     AND type = _type
     AND created_at >= now() - interval '24 hours'
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_user_id, _type, _title, _body, _link)
  RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$function$;