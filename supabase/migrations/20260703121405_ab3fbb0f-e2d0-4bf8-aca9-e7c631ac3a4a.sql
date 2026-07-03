/* ============================================================================
   Three audit fixes in one apply (all idempotent, timestamp > 20260716000000):

   (1) EARLY-BIRD COUNTER (HIGH)
   (2) REFERRAL LEADERBOARD PRIZES
   (3) purge_user_data GAPS
   ============================================================================ */

CREATE OR REPLACE FUNCTION public.get_early_bird_count()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.tutor_workspace_settings
  WHERE independent_workspace = true
    AND subscription_status IN ('active', 'trial');
$$;
COMMENT ON FUNCTION public.get_early_bird_count() IS
  'Aggregate-only: returns a single integer (early-bird uptake) — no row data, no parameters.';
REVOKE ALL ON FUNCTION public.get_early_bird_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_early_bird_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.award_referral_leaderboard_prizes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz := date_trunc('month', now()) - interval '1 month';
  _end   timestamptz := date_trunc('month', now());
  _ym    text := to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM');
  _rank  integer := 0;
  _days  integer;
  _label text;
  _rec   record;
  _awarded integer := 0;
BEGIN
  FOR _rec IN
    SELECT r.referrer_id,
           count(*) FILTER (WHERE r.upgraded_to_pro_at >= _start AND r.upgraded_to_pro_at < _end)::int AS pro_upgrades,
           count(*) FILTER (WHERE r.signed_up_at >= _start AND r.signed_up_at < _end)::int AS signups
    FROM public.referrals r
    GROUP BY r.referrer_id
    HAVING count(*) FILTER (WHERE r.upgraded_to_pro_at >= _start AND r.upgraded_to_pro_at < _end) >= 1
    ORDER BY 2 DESC, 3 DESC
    LIMIT 10
  LOOP
    _rank := _rank + 1;
    _days := CASE WHEN _rank = 1 THEN 180 WHEN _rank <= 3 THEN 90 ELSE 30 END;
    _label := CASE WHEN _rank = 1 THEN '+6 місяців' WHEN _rank <= 3 THEN '+3 місяці' ELSE '+1 місяць' END;

    IF EXISTS (
      SELECT 1 FROM public.pro_bonus_ledger
      WHERE tutor_id = _rec.referrer_id
        AND reason = 'referral_leaderboard'
        AND metadata->>'month' = _ym
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.grant_pro_days(
      _rec.referrer_id, _days, 'referral_leaderboard',
      jsonb_build_object('month', _ym, 'rank', _rank, 'pro_upgrades', _rec.pro_upgrades)
    );

    BEGIN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        _rec.referrer_id,
        'referral_leaderboard',
        '🏆 Ти в топі рефералів місяця!',
        format('Місце %s за %s — нараховано %s Pro. Дякуємо, що розповідаєш про oTutorHub! 🎉', _rank, _ym, _label),
        '/my-referrals'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    _awarded := _awarded + 1;
  END LOOP;

  RETURN _awarded;
END;
$$;
REVOKE ALL ON FUNCTION public.award_referral_leaderboard_prizes() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'award-referral-leaderboard';

SELECT cron.schedule(
  'award-referral-leaderboard',
  '15 0 1 * *',
  $$ SELECT public.award_referral_leaderboard_prizes(); $$
);

/* ── add_or_link_independent_student — ghost-only reclaim + link notice ── */
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

    IF (NOT _is_student)
       AND (public.has_role(_existing, 'tutor'::app_role)
            OR public.has_role(_existing, 'manager'::app_role)) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF (NOT _is_student)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _existing) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF _is_student THEN
      _sid := _existing; _action := 'linked';
    ELSE
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
    _sid := gen_random_uuid(); _action := 'created';
    INSERT INTO public.profiles (id, first_name, last_name, is_pending)
      VALUES (_sid, NULLIF(trim(_first_name), ''), NULLIF(trim(_last_name), ''), true);
    INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role);
    INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
      VALUES (_sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.student_rates
    WHERE tutor_id = _caller AND student_id = _sid
      AND source = 'independent'::text AND archived_at IS NULL
  ) THEN
    INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
      VALUES (_caller, _sid, _subject, COALESCE(_price, 0), COALESCE(NULLIF(_currency,''), 'UAH'), 'independent');

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
        NULL;
      END;
    END IF;
  END IF;

  INSERT INTO public.student_details (user_id) VALUES (_sid) ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('student_id', _sid, 'action', _action);
END $$;

/* ── link_student_by_email — same link notice ── */
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can add students';
  END IF;
  IF _email IS NULL OR length(trim(_email)) = 0 THEN
    RAISE EXCEPTION 'Email required';
  END IF;

  SELECT pc.user_id INTO _student_id
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

/* ── lessons.source isolation enforced by the DB ── */
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

/* ── purge_user_data — full re-issue with all gap fixes (incl. wallet) ── */
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

  DELETE FROM public.student_wallet_transactions WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.subscription_requests   WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments         WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;

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