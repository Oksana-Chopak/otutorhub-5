/* ===== 20260618170000: remove tutor payout from student-visible rows ===== */
ALTER TABLE public.group_enrollments
  DROP COLUMN IF EXISTS tutor_payout;

ALTER TABLE public.lesson_participants
  DROP COLUMN IF EXISTS tutor_payout,
  DROP COLUMN IF EXISTS tutor_payout_status,
  DROP COLUMN IF EXISTS tutor_paid_at;

/* ===== 20260618170001: workspace settings full lockdown ===== */
CREATE OR REPLACE FUNCTION public.guard_tutor_workspace_settings_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.allow_grant_pro_days', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.allow_independent_optin', true) = '1'
     AND NEW.independent_workspace = true
     AND NEW.subscription_status      IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.subscription_until       IS NOT DISTINCT FROM OLD.subscription_until
     AND NEW.current_plan             IS NOT DISTINCT FROM OLD.current_plan
     AND NEW.liqpay_recurring_active  IS NOT DISTINCT FROM OLD.liqpay_recurring_active
     AND NEW.liqpay_card_token        IS NOT DISTINCT FROM OLD.liqpay_card_token
     AND NEW.trial_until              IS NOT DISTINCT FROM OLD.trial_until
  THEN
    RETURN NEW;
  END IF;
  IF NEW.independent_workspace     IS DISTINCT FROM OLD.independent_workspace
     OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_until      IS DISTINCT FROM OLD.subscription_until
     OR NEW.current_plan            IS DISTINCT FROM OLD.current_plan
     OR NEW.liqpay_recurring_active IS DISTINCT FROM OLD.liqpay_recurring_active
     OR NEW.liqpay_card_token       IS DISTINCT FROM OLD.liqpay_card_token
     OR NEW.trial_until             IS DISTINCT FROM OLD.trial_until
  THEN
    RAISE EXCEPTION 'Only a manager can change subscription / billing / trial / workspace flags'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_tutor_workspace_settings_update ON public.tutor_workspace_settings;
CREATE TRIGGER guard_tutor_workspace_settings_update
  BEFORE UPDATE ON public.tutor_workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_tutor_workspace_settings_update();

REVOKE UPDATE ON public.tutor_workspace_settings FROM authenticated;
GRANT UPDATE (
  ai_notes_auto, ai_notes_auto_send, auto_complete_lessons, auto_complete_prompted,
  cancel_fee_percent, cancel_free_hours, created_at, custom_currencies,
  daily_digest_enabled, free_reschedules_per_month, marketing_opt_in, noshow_charge,
  notify_email, notify_telegram, onboarding_completed, onboarding_step,
  payment_due_days, payment_due_mode, payment_reminder_enabled,
  payment_rules_configured, reward_theme, tutor_id, updated_at
) ON public.tutor_workspace_settings TO authenticated;