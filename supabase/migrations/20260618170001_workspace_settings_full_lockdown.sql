/* ============================================================================
   SECURITY FIX (#3, #4): tutor_workspace_settings self-promotion / trial extend.

   #3 — trial self-extend: the April guard (20260424125121) blocked trial_until, but
        the June re-write (20260617140000) dropped it from the blocked set, so tutors
        could push trial_until forever. Re-add it. SAFE: every legitimate trial
        writer (claim_referral, 30-day streak) goes through grant_pro_days(), which
        sets app.allow_grant_pro_days — already exempted by the guard. The initial
        trial is an INSERT, which a BEFORE UPDATE trigger never sees.

   #4 — self-promote Pro / independent: re-assert the BEFORE UPDATE trigger that
        blocks the 6 billing/workspace columns for non-managers, AND re-issue the
        column-privilege lock (REVOKE table UPDATE + GRANT only the safe columns) so
        the protection holds at BOTH the trigger and privilege levels. (NOTE: the
        previous lock, applied as 20260618150457, was mangled by the apply pipeline
        into escaped \n and ran as an inert comment — so it never took. This re-issues
        it cleanly. Verify in the Security panel after applying.)

   Block-comments (/* */) on purpose, to survive newline mangling better than --.
   Idempotent.
   ============================================================================ */

CREATE OR REPLACE FUNCTION public.guard_tutor_workspace_settings_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  /* service role / cron / migration (no JWT): allow (LiqPay callback, admin) */
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  /* managers may change anything */
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;
  /* legitimate server-side Pro/trial grants (referral, streak) run through
     grant_pro_days as the tutor; grant_pro_days sets this transaction-local flag */
  IF current_setting('app.allow_grant_pro_days', true) = '1' THEN
    RETURN NEW;
  END IF;
  /* tutor opting their OWN workspace into independent — only that flag, only via
     set_own_independent_workspace(), no billing/trial column touched */
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
  /* otherwise a non-manager may NOT change any privileged column (incl trial_until) */
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

/* Privilege-level lock: revoke table-wide UPDATE, grant back ONLY the safe columns.
   All 7 sensitive columns (incl trial_until) are omitted -> unwritable by any
   authenticated client; only SECURITY DEFINER RPCs / service role can write them. */
REVOKE UPDATE ON public.tutor_workspace_settings FROM authenticated;
GRANT UPDATE (
  ai_notes_auto, ai_notes_auto_send, auto_complete_lessons, auto_complete_prompted,
  cancel_fee_percent, cancel_free_hours, created_at, custom_currencies,
  daily_digest_enabled, free_reschedules_per_month, marketing_opt_in, noshow_charge,
  notify_email, notify_telegram, onboarding_completed, onboarding_step,
  payment_due_days, payment_due_mode, payment_reminder_enabled,
  payment_rules_configured, reward_theme, tutor_id, updated_at
) ON public.tutor_workspace_settings TO authenticated;
