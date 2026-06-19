/* ============================================================================
   Two remaining scanner findings:
   (A) Critical "Tutors can self-extend trial subscriptions indefinitely"
   (B) Warning  "Students can subscribe to the lesson-details broadcast channel,
                 which may carry payout and Fireflies data"

   (A) trial_until is written by exactly one function, grant_pro_days(), which adds
       N days per call (hence "indefinitely" if a tutor could call it). It is meant to
       be reachable ONLY from the SECURITY DEFINER flows claim_referral() /
       mark_referral_pro_upgrade() / update_tutor_streak() (which run as the function
       owner) and from managers / service role. No frontend or edge code calls it
       directly. So re-assert that authenticated/anon/public cannot EXECUTE it, and
       re-assert the column-level lock so trial_until (and the 6 billing/workspace
       columns) are never directly UPDATE-able by an authenticated client. Tutors write
       their safe settings via update_my_workspace_settings() (20260618190000); they
       have no UPDATE policy on the table at all.

   (B) The realtime topic 'lesson-details:<id>' is NOT used anywhere in the app
       (no sender, no subscriber — grep-verified). The leftover authorization policy
       still let a student / group participant SUBSCRIBE to it, and a lesson-details
       payload could carry tutor_payout / Fireflies transcript. Restrict the policy to
       the lesson's tutor + managers (who already legitimately see that data). Nothing
       breaks because the channel is unused.

   Idempotent: REVOKE / GRANT / DROP POLICY IF EXISTS / CREATE POLICY are re-runnable.
   ============================================================================ */

/* (A.1) trial-extension function is owner/manager/service only — never client-callable. */
REVOKE EXECUTE ON FUNCTION public.grant_pro_days(uuid, integer, text, jsonb) FROM PUBLIC, anon, authenticated;

/* (A.2) Re-assert the column lock: no authenticated client may UPDATE trial_until or
   any of the 6 billing/workspace columns. Only the safe, tutor-editable columns are
   GRANTed (and even those are now written via the SECURITY DEFINER RPC; managers may
   still update them directly). Matches the live lockdown, minus any stale trial_until. */
REVOKE UPDATE ON public.tutor_workspace_settings FROM authenticated;
GRANT UPDATE (
  ai_notes_auto, ai_notes_auto_send, auto_complete_lessons, auto_complete_prompted,
  cancel_fee_percent, cancel_free_hours, created_at, custom_currencies,
  daily_digest_enabled, free_reschedules_per_month, marketing_opt_in, noshow_charge,
  notify_email, notify_telegram, onboarding_completed, onboarding_step,
  payment_due_days, payment_due_mode, payment_reminder_enabled,
  payment_rules_configured, reward_theme, tutor_id, updated_at
) ON public.tutor_workspace_settings TO authenticated;

/* (B) Restrict the lesson-details realtime topic to the lesson's tutor + managers. */
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
