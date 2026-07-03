/* ============================================================================
   Three audit fixes in one apply (all idempotent, timestamp > 20260716000000):

   (1) EARLY-BIRD COUNTER (HIGH): SubscriptionPage counted tutor_workspace_settings
       rows CLIENT-SIDE, but RLS is SELECT-own-only, so every tutor saw 0/1 and the
       "N of 20 spots left" badge always showed ~19 — fake scarcity. Fix: a
       SECURITY DEFINER aggregate-only RPC (returns ONE integer, no args, no rows —
       cannot become an RLS oracle).

   (2) REFERRAL LEADERBOARD PRIZES (owner-confirmed promo): /my-referrals promised
       monthly prizes (🥇 +6 mo · 🥈🥉 +3 mo · 4–10 → +1 mo) with NO grant mechanism
       in the DB. Fix: award function ranked exactly like get_referral_leaderboard
       (paid upgrades DESC, signups as tiebreak), anti-farming: a prize REQUIRES
       ≥1 paid upgrade that month (signup-only farmers get nothing); idempotent per
       (tutor, month) via pro_bonus_ledger metadata; monthly pg_cron on the 1st.

   (3) purge_user_data GAPS (HIGH): account deletion left orphan rows in 17 tables
       (referral_codes, referrals, pro_bonus_ledger, tutor_streaks, tutor_badges,
       tutor_notes, tutor_daily_digests, google_calendar_tokens, lesson_feedback,
       lesson_reminders, chat_message_reactions, student_intake_quiz,
       student_rewards, tutor_student_pairs, feedback_submissions,
       marketing_unsubscribe_tokens, platform_admins) + avatar storage objects.
       Fix: re-issue the function with the gaps closed, FK-safe order (children
       before lessons/chat_messages). Email-keyed suppression lists
       (marketing_unsubscribes, suppressed_emails, email_unsubscribe_tokens) are
       KEPT on purpose — we must not re-email deleted users.
   ============================================================================ */

/* ── (1) Early-bird count ─────────────────────────────────────────────────── */
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

/* ── (2) Referral leaderboard prizes ─────────────────────────────────────────
   Awards the PREVIOUS calendar month. Ranking = get_referral_leaderboard's:
   paid upgrades in month DESC, signups in month DESC. Prize requires ≥1 paid
   upgrade. Grants go through grant_pro_days (ledger + guard-trigger exemption). */
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

    /* idempotent: one prize per (tutor, month) even if the job re-runs */
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

    /* best-effort winner notification — never fail the awarding loop */
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
/* cron/service only — an unbounded Pro granter must never be callable by users
   (same invariant as grant_pro_days). */
REVOKE ALL ON FUNCTION public.award_referral_leaderboard_prizes() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'award-referral-leaderboard';

/* 00:15 UTC on the 1st — awards the month that just ended */
SELECT cron.schedule(
  'award-referral-leaderboard',
  '15 0 1 * *',
  $$ SELECT public.award_referral_leaderboard_prizes(); $$
);

/* ── (3) purge_user_data — close the orphan gaps ─────────────────────────────
   Body = the live 20260709000000 version + the missing tables, inserted in
   FK-safe order (lesson-/message-children before their parents). */
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

  DELETE FROM public.subscription_requests   WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments         WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;

  /* referral / gamification / integrations — the former orphans */
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

  /* avatar files (uploaded under <user_id>/... in the avatars bucket) — best effort:
     storage.objects is owned by the storage admin role; if the grant isn't there,
     the account purge must still succeed. */
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
