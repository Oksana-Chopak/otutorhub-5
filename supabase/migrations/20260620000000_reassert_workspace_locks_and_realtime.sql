/* ============================================================================
   Re-assert the tutor_workspace_settings privilege locks + lesson-details realtime
   restriction at a timestamp that is GUARANTEED to run.

   WHY: the previous corrective migration 20260619000000_lock_trial_grant_and_realtime
   has a timestamp (…000000) that sorts BEFORE the already-applied Lovable hash
   migration 20260619071130. Supabase's migration runner only executes versions GREATER
   than the recorded high-water mark, so 20260619000000 is SILENTLY SKIPPED — its
   grant_pro_days EXECUTE revoke and realtime policy never ran, and the live column GRANT
   on tutor_workspace_settings still exposes trial_until to the authenticated role
   (which the security scan reads from live DB state and flags as
   "tutors can self-extend trial subscriptions indefinitely").

   This file uses a timestamp strictly greater than 20260619071130 so it WILL run.
   All statements are idempotent. Real newlines + block comments (survive the Lovable
   apply pipeline, which once mangled a migration into a single inert comment line).
   ============================================================================ */

/* (1) Column-level lock on tutor_workspace_settings.
   Normalize: revoke table-wide UPDATE from authenticated, then GRANT UPDATE back on
   ONLY the safe, tutor-editable columns. Then EXPLICITLY revoke UPDATE on each of the 7
   privileged billing/subscription columns from authenticated + anon, so the lock is
   unambiguous at the column level regardless of any earlier GRANT in the history. */
REVOKE UPDATE ON public.tutor_workspace_settings FROM authenticated;

GRANT UPDATE (
  ai_notes_auto, ai_notes_auto_send, auto_complete_lessons, auto_complete_prompted,
  cancel_fee_percent, cancel_free_hours, created_at, custom_currencies,
  daily_digest_enabled, free_reschedules_per_month, marketing_opt_in, noshow_charge,
  notify_email, notify_telegram, onboarding_completed, onboarding_step,
  payment_due_days, payment_due_mode, payment_reminder_enabled,
  payment_rules_configured, reward_theme, tutor_id, updated_at
) ON public.tutor_workspace_settings TO authenticated;

REVOKE UPDATE (
  trial_until, subscription_status, subscription_until, current_plan,
  independent_workspace, liqpay_recurring_active, liqpay_card_token
) ON public.tutor_workspace_settings FROM authenticated, anon, PUBLIC;

/* (2) grant_pro_days() is the only function that directly writes trial_until (adds N
   days per call). It must be reachable ONLY from the SECURITY DEFINER referral/streak
   flows (which run as the function owner), managers, and the service role — never
   directly from a client. Re-assert the EXECUTE revoke (the skipped 000000 carried it). */
REVOKE EXECUTE ON FUNCTION public.grant_pro_days(uuid, integer, text, jsonb) FROM PUBLIC, anon, authenticated;

/* (3) lesson-details realtime topic: restrict to the lesson's tutor + managers.
   The 'lesson-details:<id>' broadcast topic is unused anywhere in the app (no sender,
   no subscriber), but the old policy let students/participants subscribe to a channel
   that could carry tutor_payout / Fireflies data. (The skipped 000000 carried this too.) */
DROP POLICY IF EXISTS "Lesson details realtime scoped" ON realtime.messages;
DROP POLICY IF EXISTS "Lesson details realtime tutor/manager only" ON realtime.messages;
CREATE POLICY "Lesson details realtime tutor/manager only"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() LIKE 'lesson-details:%'
    AND (
      public.has_role('manager'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.lessons l
        WHERE l.id::text = split_part(realtime.topic(), ':', 2)
          AND l.tutor_id = auth.uid()
      )
    )
  );
