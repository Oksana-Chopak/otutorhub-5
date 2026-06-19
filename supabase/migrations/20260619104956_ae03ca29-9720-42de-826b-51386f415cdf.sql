REVOKE EXECUTE ON FUNCTION public.grant_pro_days(uuid, integer, text, jsonb) FROM PUBLIC, anon, authenticated;

REVOKE UPDATE ON public.tutor_workspace_settings FROM authenticated;
GRANT UPDATE (
  ai_notes_auto, ai_notes_auto_send, auto_complete_lessons, auto_complete_prompted,
  cancel_fee_percent, cancel_free_hours, created_at, custom_currencies,
  daily_digest_enabled, free_reschedules_per_month, marketing_opt_in, noshow_charge,
  notify_email, notify_telegram, onboarding_completed, onboarding_step,
  payment_due_days, payment_due_mode, payment_reminder_enabled,
  payment_rules_configured, reward_theme, tutor_id, updated_at
) ON public.tutor_workspace_settings TO authenticated;

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