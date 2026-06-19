/* ===== 20260621000000_p0_isolation_complete ===== */
DROP POLICY IF EXISTS "lessons_select"                 ON public.lessons;
DROP POLICY IF EXISTS "Manager views all lessons"      ON public.lessons;
DROP POLICY IF EXISTS "Manager views hub lessons only" ON public.lessons;
CREATE POLICY "lessons_select"
ON public.lessons FOR SELECT TO authenticated
USING (
  (public.has_role(auth.uid(), 'manager'::app_role) AND (source = 'hub' OR source IS NULL))
  OR auth.uid() = tutor_id
  OR auth.uid() = student_id
  OR (
    lesson_type IN ('pair', 'group')
    AND group_id IS NOT NULL
    AND public.is_group_active_student(group_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "Manager creates any lessons" ON public.lessons;
DROP POLICY IF EXISTS "Manager creates any lesson"  ON public.lessons;
DROP POLICY IF EXISTS "Manager creates hub lessons" ON public.lessons;
CREATE POLICY "Manager creates hub lessons"
ON public.lessons FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "Manager updates any lesson"  ON public.lessons;
DROP POLICY IF EXISTS "Manager updates any lessons" ON public.lessons;
DROP POLICY IF EXISTS "Manager updates hub lessons" ON public.lessons;
CREATE POLICY "Manager updates hub lessons"
ON public.lessons FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL))
WITH CHECK (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "Manager deletes any lesson"  ON public.lessons;
DROP POLICY IF EXISTS "Manager deletes any lessons" ON public.lessons;
DROP POLICY IF EXISTS "Manager deletes hub lessons" ON public.lessons;
CREATE POLICY "Manager deletes hub lessons"
ON public.lessons FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "lesson_details_manager_all"      ON public.lesson_details;
DROP POLICY IF EXISTS "lesson_details_manager_hub_only" ON public.lesson_details;
CREATE POLICY "lesson_details_manager_hub_only"
ON public.lesson_details FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id
      AND public.has_role(auth.uid(), 'manager')
      AND (l.source = 'hub' OR l.source IS NULL)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id
      AND public.has_role(auth.uid(), 'manager')
      AND (l.source = 'hub' OR l.source IS NULL)
  )
);

DROP POLICY IF EXISTS "Manager manages student rates"  ON public.student_rates;
DROP POLICY IF EXISTS "Manager sees all rates"         ON public.student_rates;
DROP POLICY IF EXISTS "Manager sees hub rates only"    ON public.student_rates;
DROP POLICY IF EXISTS "Manager manages hub rates only" ON public.student_rates;
CREATE POLICY "Manager manages hub rates only"
ON public.student_rates FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND student_rates.source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
  AND student_rates.source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
);

DROP POLICY IF EXISTS "Lesson participants view attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants view attachments"
ON public.lesson_attachments FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.lessons lm
      WHERE lm.id = lesson_attachments.lesson_id
        AND (lm.source = 'hub' OR lm.source IS NULL)
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_attachments.lesson_id
      AND (
        auth.uid() = l.tutor_id
        OR auth.uid() = l.student_id
        OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.lesson_participants lp
          WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "Lesson participants read lesson-attachments" ON storage.objects;
CREATE POLICY "Lesson participants read lesson-attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    (
      public.has_role(auth.uid(), 'manager'::app_role)
      AND EXISTS (
        SELECT 1
        FROM public.lesson_attachments am
        JOIN public.lessons lm ON lm.id = am.lesson_id
        WHERE am.storage_path = storage.objects.name
          AND (lm.source = 'hub' OR lm.source IS NULL)
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.lesson_attachments a
      JOIN public.lessons l ON l.id = a.lesson_id
      WHERE a.storage_path = storage.objects.name
        AND (
          auth.uid() = l.tutor_id
          OR auth.uid() = l.student_id
          OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
          OR EXISTS (
            SELECT 1 FROM public.lesson_participants lp
            WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
          )
        )
    )
  )
);

/* ===== 20260622000000_referral_and_notification_hardening ===== */
CREATE OR REPLACE FUNCTION public.claim_referral(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _referrer_id uuid;
  _new_user uuid := auth.uid();
  _existing uuid;
BEGIN
  IF _new_user IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_code');
  END IF;

  SELECT tutor_id INTO _referrer_id FROM public.referral_codes WHERE upper(code) = upper(trim(_code));
  IF _referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF _referrer_id = _new_user THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self');
  END IF;

  SELECT id INTO _existing FROM public.referrals WHERE referred_id = _new_user;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, code, signup_bonus_granted)
  VALUES (_referrer_id, _new_user, upper(trim(_code)), true);

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 30, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id uuid,
  _type    text,
  _title   text,
  _body    text DEFAULT NULL,
  _link    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    OR public.has_role(_caller, 'manager'::app_role)
    OR public.has_role(_user_id, 'manager'::app_role)
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
$$;
REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_managers(
  _type  text,
  _title text,
  _body  text DEFAULT NULL,
  _link  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _m     record;
  _count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'type and title are required';
  END IF;
  IF _link IS NOT NULL AND (left(_link, 1) <> '/' OR left(_link, 2) = '//') THEN
    RAISE EXCEPTION 'notification link must be a relative path' USING ERRCODE = 'check_violation';
  END IF;

  FOR _m IN
    SELECT DISTINCT user_id
      FROM public.user_roles
     WHERE role = 'manager'::app_role
  LOOP
    PERFORM public.create_notification(_m.user_id, _type, _title, _body, _link);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;
REVOKE ALL  ON FUNCTION public.notify_managers(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_managers(text, text, text, text) TO authenticated;

/* ===== 20260623000000_low_security_hardening ===== */
DO $do$
BEGIN
  IF to_regclass('public.student_rewards') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "tutor_insert_rewards" ON public.student_rewards';
    EXECUTE $pol$
      CREATE POLICY "tutor_insert_rewards" ON public.student_rewards
        FOR INSERT TO authenticated
        WITH CHECK (
          auth.uid() = tutor_id
          AND (
            EXISTS (
              SELECT 1 FROM public.student_rates r
              WHERE r.tutor_id = auth.uid() AND r.student_id = student_rewards.student_id
            )
            OR EXISTS (
              SELECT 1 FROM public.lessons l
              WHERE l.tutor_id = auth.uid()
                AND (
                  l.student_id = student_rewards.student_id
                  OR EXISTS (
                    SELECT 1 FROM public.lesson_participants lp
                    WHERE lp.lesson_id = l.id AND lp.student_id = student_rewards.student_id
                  )
                )
            )
          )
        )
    $pol$;
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.get_tutor_independent_student_count(_tutor_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT student_id)::INTEGER
  FROM public.student_rates
  WHERE tutor_id = _tutor_id
    AND source = 'independent'
    AND (_tutor_id = auth.uid() OR public.has_role(auth.uid(), 'manager'::app_role));
$$;

CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 129 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id
    AND reason IN ('referral_pro_upgrade', 'referral_3_pro_in_month', 'referral_signup_referrer')
    AND (_tutor_id = auth.uid() OR public.has_role(auth.uid(), 'manager'::app_role));
$$;