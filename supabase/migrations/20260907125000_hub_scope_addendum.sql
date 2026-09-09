-- ═══════════════════════════════════════════════════════════════════════════
-- ХАБ — доповнення до етапів B–C (07.09, після перевірки живої бази етапом D)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Етап D (20260907130000_hub_scope_assert) дивиться в pg_policies і pg_proc,
-- а не у файл міграції — і саме так знайшлось те, що свіп по файлу проминув:
--
--   1. feedback_submissions — дві політики з іменами БЕЗ лапок (свіп шукав
--      лише "…"): менеджер будь-якої школи читав і закривав звернення всіх.
--      Звернення в застосунку (ідеї, баги) — платформенне → лише суперадмін.
--   2. set_group_enrollment_price / set_group_participant_payment — ціна
--      групового запису і оплата учасників: перевіряли has_role(manager) і
--      source='hub', але не ШКОЛУ репетитора → менеджер школи Б міг ставити
--      ціни й «оплачено» групам школи А.
--   3. is_group_tutor / is_group_active_student — «менеджер питає про будь-кого»
--      → лише про репетитора/учня своєї школи.
--   4. create_notification — «менеджер сповіщає будь-кого; будь-хто сповіщає
--      будь-якого менеджера» → менеджер лише свою школу; менеджера — лише
--      його ж школа (або суперадміна — платформенна підтримка, як у
--      notify_managers для незалежних).
--
-- Тіла функцій — дослівно живі (pg_get_functiondef), додано лише скоуп.
-- ІДЕМПОТЕНТНО: DROP POLICY IF EXISTS + CREATE OR REPLACE.
--
-- LIVE-MARKER-NONE: нових об'єктів немає — доводиться етапом D (✅ «чисто»).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Звернення в застосунку — платформенне ─────────────────────────────────
DROP POLICY IF EXISTS feedback_select_own_or_manager ON public.feedback_submissions;
CREATE POLICY feedback_select_own_or_manager ON public.feedback_submissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));

DROP POLICY IF EXISTS feedback_update_manager ON public.feedback_submissions;
CREATE POLICY feedback_update_manager ON public.feedback_submissions FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()))
  WITH CHECK ((public.has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()));

-- ── 2. Групи: ціна запису й оплата учасників — лише своя школа ───────────────
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

  /* хаб-модель 07.09: менеджер — лише репетитора СВОЄЇ школи */
  _is_mgr := public.is_hub_manager_of(_group_tutor);
  _tutor_independent := EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = _group_tutor AND ws.independent_workspace = true
  );

  IF NOT (
    (_is_mgr AND NOT _tutor_independent)              /* hub group → manager */
    OR (_uid = _group_tutor AND _tutor_independent)   /* independent group → owner */
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
       /* hub money → hub-scoped manager only (хаб-модель 07.09: школа репетитора) */
       (_is_mgr AND (l.source = 'hub' OR l.source IS NULL) AND public.is_hub_scoped(l.tutor_id))
       /* independent money → the owning independent tutor */
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

-- ── 3. Предикати груп: менеджер питає лише про свою школу ────────────────────
-- (усі політики викликають їх з auth.uid() — гілка менеджера там не працює;
--  закриваємо лише прямий виклик RPC «чи X — репетитор/учень групи G»)
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

-- ── 4. Сповіщення: менеджер ↔ лише своя школа ────────────────────────────────
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

  /* Link must be a relative same-origin path (leading single slash). Blocks
     http(s)://, protocol-relative //evil, and javascript: links. */
  IF _link IS NOT NULL AND (left(_link, 1) <> '/' OR left(_link, 2) = '//') THEN
    RAISE EXCEPTION 'notification link must be a relative path' USING ERRCODE = 'check_violation';
  END IF;

  /* Authorization: only notify a user you relate to — self, a manager of your
     own school (хаб-модель 07.09: менеджер сповіщає лише СВОЮ школу; менеджера
     сповіщає лише його школа — або будь-хто суперадміна, як платформенну
     підтримку; належність до platform_admins / hub_managers і є «менеджер»,
     тож has_role(<інший користувач>) тут не потрібен), or a shared
     tutor↔student relationship (rate, lesson, group enrollment, or chat thread). */
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

  -- Dedup: skip if the same user+type was notified within the last 24h.
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
