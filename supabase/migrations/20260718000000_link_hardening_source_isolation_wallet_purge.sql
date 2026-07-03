/* ============================================================================
   Security hardening batch (audit findings), idempotent, timestamp > 20260717000000:

   (1) UNSOLICITED LINK / GHOST RECLAIM (MED): add_or_link_independent_student let
       any tutor attach to ANY account by email, and its "reclaim" branch would
       overwrite the profile/contacts of any role-less account — including REAL
       registered auth accounts in a weird state. Now: reclaim is allowed ONLY for
       true ghosts (no auth.users row — i.e. pending cards this flow itself
       creates); linking an existing student notifies the student (in-app bell)
       so no tutor→student relationship is ever created silently.
       link_student_by_email gets the same notification.

   (2) lessons.source ISOLATION AT THE DB LAYER (MED): source defaults to 'hub'
       and the generic tutor INSERT policies carry no source predicate, so an
       independent tutor's insert that omitted source (client bug or hand-crafted
       PostgREST call) landed manager-visible. RESTRICTIVE INSERT/UPDATE policies
       now force independent-workspace tutors' lessons to source='independent'
       regardless of which permissive policy matched.

   (3) purge_user_data: adds the missed student_wallet_transactions rows
       (student_wallet_balances is a view over it). Full function re-issued —
       identical to 20260717000000 otherwise — so it applies correctly whether or
       not that migration ran first.
   ============================================================================ */

/* ── (1a) add_or_link_independent_student — ghost-only reclaim + link notice ── */
CREATE OR REPLACE FUNCTION public.add_or_link_independent_student(
  _first_name text,
  _last_name  text,
  _email      text,
  _phone      text,
  _telegram   text,
  _subject    text,
  _price      numeric,
  _currency   text DEFAULT 'UAH'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller     uuid := auth.uid();
  _email_n    text := NULLIF(lower(trim(_email)), '');
  _existing   uuid;
  _is_student boolean := false;
  _sid        uuid;
  _action     text;
  _tutor_name text;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_role(_caller, 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can add students';
  END IF;
  IF (NULLIF(trim(_first_name), '') IS NULL AND NULLIF(trim(_last_name), '') IS NULL) THEN
    RAISE EXCEPTION 'Name required';
  END IF;

  IF _email_n IS NOT NULL THEN
    SELECT pc.user_id INTO _existing
    FROM public.profile_contacts pc
    WHERE lower(pc.email) = _email_n
    LIMIT 1;
  END IF;

  IF _existing IS NOT NULL THEN
    _is_student := public.has_role(_existing, 'student'::app_role);

    -- A genuine tutor/manager account cannot be turned into a student.
    IF (NOT _is_student)
       AND (public.has_role(_existing, 'tutor'::app_role)
            OR public.has_role(_existing, 'manager'::app_role)) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    -- HARDENING: the reclaim branch may only touch TRUE ghosts — profile/contacts
    -- rows with NO auth account behind them (the pending cards this flow creates).
    -- A real registered account without a student role must not be silently
    -- converted/overwritten by whoever knows the email.
    IF (NOT _is_student)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _existing) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF _is_student THEN
      _sid := _existing; _action := 'linked';
    ELSE
      -- Ghost/half-created card (no auth user): reclaim.
      _sid := _existing; _action := 'reclaimed';
      INSERT INTO public.profiles (id, first_name, last_name, is_pending)
        VALUES (_sid, NULLIF(trim(_first_name), ''), NULLIF(trim(_last_name), ''), true)
        ON CONFLICT (id) DO UPDATE
          SET first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
              last_name  = COALESCE(EXCLUDED.last_name,  public.profiles.last_name);
      INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role)
        ON CONFLICT DO NOTHING;
      INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
        SELECT _sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), '')
        WHERE NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = _sid);
      UPDATE public.profile_contacts
        SET phone    = COALESCE(NULLIF(trim(_phone), ''), phone),
            telegram = COALESCE(NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''), telegram)
        WHERE user_id = _sid;
    END IF;
  ELSE
    -- Brand-new student.
    _sid := gen_random_uuid(); _action := 'created';
    INSERT INTO public.profiles (id, first_name, last_name, is_pending)
      VALUES (_sid, NULLIF(trim(_first_name), ''), NULLIF(trim(_last_name), ''), true);
    INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role);
    INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
      VALUES (_sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''));
  END IF;

  -- Per-tutor rate link (idempotent — the "many tutors" part).
  IF NOT EXISTS (
    SELECT 1 FROM public.student_rates
    WHERE tutor_id = _caller AND student_id = _sid
      AND source = 'independent'::text AND archived_at IS NULL
  ) THEN
    INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
      VALUES (_caller, _sid, _subject, COALESCE(_price, 0), COALESCE(NULLIF(_currency,''), 'UAH'), 'independent');

    -- HARDENING: linking an EXISTING student is never silent — bell them.
    IF _action = 'linked' THEN
      BEGIN
        SELECT NULLIF(trim(concat(p.first_name, ' ', p.last_name)), '') INTO _tutor_name
        FROM public.profiles p WHERE p.id = _caller;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (
          _sid,
          'tutor_linked',
          '🤝 Вас додали як учня',
          format('Репетитор %s додав вас як свого учня (%s). Якщо це помилка — напишіть у підтримку.',
                 COALESCE(_tutor_name, 'oTutorHub'), COALESCE(NULLIF(trim(_subject), ''), '—')),
          '/student-dashboard'
        );
      EXCEPTION WHEN OTHERS THEN
        NULL; -- best effort: never fail the add over a notification
      END;
    END IF;
  END IF;

  INSERT INTO public.student_details (user_id) VALUES (_sid) ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('student_id', _sid, 'action', _action);
END $$;

/* ── (1b) link_student_by_email — same link notice ─────────────────────────── */
CREATE OR REPLACE FUNCTION public.link_student_by_email(
  _email    text,
  _subject  text,
  _price    numeric,
  _currency text DEFAULT 'UAH'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _student_id uuid;
  _tutor_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF NOT public.has_role(auth.uid(), 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can add students';
  END IF;
  IF _email IS NULL OR length(trim(_email)) = 0 THEN
    RAISE EXCEPTION 'Email required';
  END IF;

  SELECT pc.user_id
    INTO _student_id
  FROM public.profile_contacts pc
  WHERE lower(pc.email) = lower(trim(_email))
  LIMIT 1;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'No existing user with this email';
  END IF;

  IF NOT public.has_role(_student_id, 'student'::app_role) THEN
    RAISE EXCEPTION 'This email does not belong to a student';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = _student_id
      AND r.source = 'independent'::text
      AND r.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Student already linked to you';
  END IF;

  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
  VALUES (auth.uid(), _student_id, _subject, COALESCE(_price, 0), COALESCE(_currency, 'UAH'), 'independent');

  -- HARDENING: linking is never silent — bell the student (best effort).
  BEGIN
    SELECT NULLIF(trim(concat(p.first_name, ' ', p.last_name)), '') INTO _tutor_name
    FROM public.profiles p WHERE p.id = auth.uid();
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      _student_id,
      'tutor_linked',
      '🤝 Вас додали як учня',
      format('Репетитор %s додав вас як свого учня (%s). Якщо це помилка — напишіть у підтримку.',
             COALESCE(_tutor_name, 'oTutorHub'), COALESCE(NULLIF(trim(_subject), ''), '—')),
      '/student-dashboard'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _student_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_student_by_email(text, text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.link_student_by_email(text, text, numeric, text) TO authenticated;

/* ── (2) lessons.source isolation enforced by the DB ───────────────────────
   RESTRICTIVE = ANDed with every permissive policy: an independent-workspace
   tutor's lesson rows MUST be source='independent', no matter which permissive
   INSERT/UPDATE policy matched. Managers/hub tutors (independent_workspace
   false/absent) are unaffected; service role bypasses RLS. */
DROP POLICY IF EXISTS "independent_source_insert_guard" ON public.lessons;
CREATE POLICY "independent_source_insert_guard"
ON public.lessons
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  source = 'independent'
  OR NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = auth.uid() AND ws.independent_workspace = true
  )
);

DROP POLICY IF EXISTS "independent_source_update_guard" ON public.lessons;
CREATE POLICY "independent_source_update_guard"
ON public.lessons
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (
  source = 'independent'
  OR NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = auth.uid() AND ws.independent_workspace = true
  )
);

/* ── (3) purge_user_data — add student_wallet_transactions (full re-issue) ── */
CREATE OR REPLACE FUNCTION public.purge_user_data(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;

  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  /* lesson children first (feedback/reminders/rewards may reference lessons) */
  DELETE FROM public.lesson_feedback
   WHERE tutor_id = _user_id OR student_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_reminders
   WHERE tutor_id = _user_id OR student_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.student_rewards WHERE student_id = _user_id OR tutor_id = _user_id;
  DELETE FROM public.lesson_attachments
   WHERE uploader_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_participants WHERE student_id = _user_id;
  DELETE FROM public.lesson_payment_reminders WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lesson_change_requests   WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id OR created_by = _user_id;

  DELETE FROM public.group_enrollments WHERE student_id = _user_id;
  DELETE FROM public.group_enrollments WHERE group_id IN (SELECT id FROM public.lesson_groups WHERE tutor_id = _user_id);
  DELETE FROM public.lesson_groups WHERE tutor_id = _user_id;

  /* the user's reactions on OTHERS' surviving messages (thread-local ones die
     with chat_messages via FK CASCADE below) */
  DELETE FROM public.chat_message_reactions WHERE user_id = _user_id;
  DELETE FROM public.chat_message_attachments
   WHERE uploader_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_messages
   WHERE sender_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_reads
   WHERE user_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.student_rates       WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_weekly    WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_overrides WHERE tutor_id = _user_id;
  DELETE FROM public.availability_requests WHERE tutor_id = _user_id OR requester_id = _user_id;
  DELETE FROM public.tutor_referral_requests WHERE student_id = _user_id;
  DELETE FROM public.tutor_student_defaults  WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_student_pairs     WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.student_intake_quiz     WHERE student_id = _user_id;

  /* wallet ledger (student_wallet_balances is a view over this table) */
  DELETE FROM public.student_wallet_transactions WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.subscription_requests   WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments         WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;

  /* referral / gamification / integrations */
  DELETE FROM public.referrals WHERE referrer_id = _user_id OR referred_id = _user_id;
  DELETE FROM public.referral_codes WHERE tutor_id = _user_id;
  DELETE FROM public.pro_bonus_ledger WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_streaks WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_badges WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_notes WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_daily_digests WHERE tutor_id = _user_id;
  DELETE FROM public.google_calendar_tokens WHERE user_id = _user_id;
  DELETE FROM public.feedback_submissions WHERE user_id = _user_id;
  DELETE FROM public.marketing_unsubscribe_tokens WHERE user_id = _user_id;
  DELETE FROM public.platform_admins WHERE user_id = _user_id;

  /* avatar files (uploaded under <user_id>/... in the avatars bucket) — best effort */
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE _user_id::text || '/%';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  DELETE FROM public.tutor_details   WHERE user_id = _user_id;
  DELETE FROM public.student_details WHERE user_id = _user_id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = _user_id;
  DELETE FROM public.profile_contacts WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  PERFORM set_config('app.pending_profile_merge', '', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
