-- ============================================================================
-- Privilege-escalation lockdown for public.tutor_workspace_settings.
--
-- Lovable's schema review flagged that the permissive "Tutor updates own settings"
-- RLS policy grants UPDATE on EVERY column, so a tutor could self-promote by
-- writing independent_workspace / subscription_status / subscription_until /
-- current_plan / liqpay_recurring_active / liqpay_card_token directly.
--
-- The behavioural guard (BEFORE UPDATE trigger, below) already blocks this at write
-- time, but a static policy review can't see triggers — and a single dropped trigger
-- would reopen the hole. So this migration adds a SECOND, privilege-level lock:
-- RLS is row-level only, so column control needs GRANTs. We REVOKE table-wide UPDATE
-- from `authenticated` and GRANT UPDATE back on ONLY the non-sensitive columns. The
-- six billing/workspace columns become unwritable by ANY authenticated client
-- (tutor or manager). Every legitimate write already goes through a SECURITY DEFINER
-- RPC (set_own_independent_workspace, grant_pro_days) or the service-role LiqPay
-- callback — both bypass column GRANTs — so nothing legitimate breaks. (Verified: no
-- client code updates these columns directly.)
--
-- Idempotent: CREATE OR REPLACE + DROP/CREATE + REVOKE/GRANT are all re-runnable.
-- ============================================================================

-- 1. Behavioural guard (re-assert, identical to 20260617140000 — defense in depth).
CREATE OR REPLACE FUNCTION public.guard_tutor_workspace_settings_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Service role / cron / migration (no JWT): allow (e.g. LiqPay callback, admin).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Managers may change anything.
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Legitimate server-side Pro grants (referral bonus / streak) run through
  -- grant_pro_days as the tutor (non-manager); grant_pro_days sets this flag.
  IF current_setting('app.allow_grant_pro_days', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Tutor opting their OWN workspace into independent — only that one flag, only via
  -- set_own_independent_workspace() (sets the flag), no billing column touched.
  IF current_setting('app.allow_independent_optin', true) = '1'
     AND NEW.independent_workspace = true
     AND NEW.subscription_status      IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.subscription_until       IS NOT DISTINCT FROM OLD.subscription_until
     AND NEW.current_plan             IS NOT DISTINCT FROM OLD.current_plan
     AND NEW.liqpay_recurring_active  IS NOT DISTINCT FROM OLD.liqpay_recurring_active
     AND NEW.liqpay_card_token        IS NOT DISTINCT FROM OLD.liqpay_card_token
  THEN
    RETURN NEW;
  END IF;

  -- Otherwise a non-manager may NOT change any privileged column.
  IF NEW.independent_workspace     IS DISTINCT FROM OLD.independent_workspace
     OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_until      IS DISTINCT FROM OLD.subscription_until
     OR NEW.current_plan            IS DISTINCT FROM OLD.current_plan
     OR NEW.liqpay_recurring_active IS DISTINCT FROM OLD.liqpay_recurring_active
     OR NEW.liqpay_card_token       IS DISTINCT FROM OLD.liqpay_card_token
  THEN
    RAISE EXCEPTION 'Only a manager can change subscription / billing / workspace flags'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_tutor_workspace_settings_update ON public.tutor_workspace_settings;
CREATE TRIGGER guard_tutor_workspace_settings_update
  BEFORE UPDATE ON public.tutor_workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_tutor_workspace_settings_update();

-- 2. Privilege-level column lockdown (the part a static schema review credits).
--    Revoke table-wide UPDATE, then grant UPDATE back on the SAFE columns only.
--    The 6 sensitive columns are intentionally omitted → no authenticated client
--    can write them; only SECURITY DEFINER RPCs / service role can.
REVOKE UPDATE ON public.tutor_workspace_settings FROM authenticated;
GRANT UPDATE (
  ai_notes_auto,
  ai_notes_auto_send,
  auto_complete_lessons,
  auto_complete_prompted,
  cancel_fee_percent,
  cancel_free_hours,
  created_at,
  custom_currencies,
  daily_digest_enabled,
  free_reschedules_per_month,
  marketing_opt_in,
  noshow_charge,
  notify_email,
  notify_telegram,
  onboarding_completed,
  onboarding_step,
  payment_due_days,
  payment_due_mode,
  payment_reminder_enabled,
  payment_rules_configured,
  reward_theme,
  trial_until,
  tutor_id,
  updated_at
) ON public.tutor_workspace_settings TO authenticated;

COMMENT ON FUNCTION public.guard_tutor_workspace_settings_update() IS
  'Blocks non-managers from changing subscription/billing/workspace columns on '
  'tutor_workspace_settings. Paired with a column-level GRANT lockdown (see '
  '20260618150000) so the protection holds at both the trigger and privilege levels.';
