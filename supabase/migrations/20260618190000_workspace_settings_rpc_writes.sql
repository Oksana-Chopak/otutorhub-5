/* ============================================================================
   Close the two "self-grant" criticals on public.tutor_workspace_settings.

   Background: the table mixes tutor-editable settings (onboarding, notify toggles,
   payment rules, reward theme, ...) with 7 PRIVILEGED billing/workspace columns
   (independent_workspace, subscription_status, subscription_until, current_plan,
   liqpay_recurring_active, liqpay_card_token, trial_until). A trigger + a column-level
   GRANT lock already blocked tutors from writing the 7 columns, BUT the security
   scanner is policy-based: it only sees that the "Tutor updates own settings" RLS
   policy grants a tutor UPDATE on a row that CONTAINS those columns, and cannot see
   triggers or column GRANTs — so it keeps reporting Critical.

   Fix: remove the tutor's direct write *policies* entirely, and route the tutor's
   legitimate (safe-column-only) settings writes through a SECURITY DEFINER RPC that
   physically cannot touch the 7 privileged columns. After this, a tutor has NO write
   policy on the table at all → the scanner has nothing to flag, and self-granting is
   impossible. Reads (SELECT own) are unchanged, so Pro/trial status display, the
   billing webhooks, grant_pro_days(), set_own_independent_workspace(), and the
   expiry cron all keep working exactly as before (the columns do NOT move).

   Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS are re-runnable.
   ============================================================================ */

/* 1. Controlled write path: applies ONLY safe, tutor-editable columns from the patch.
      Privileged keys are stripped, so even a crafted client payload can't self-grant.
      jsonb_populate_record merges the patch over the current row, handling every
      column type (incl. custom_currencies text[]) without manual casts. */
CREATE OR REPLACE FUNCTION public.update_my_workspace_settings(_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _safe jsonb;
  _merged public.tutor_workspace_settings;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Auth required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  /* Ensure a row exists (matches the old upsert behaviour; all other columns have
     defaults, which is why the previous client-side upsert worked with only tutor_id). */
  INSERT INTO public.tutor_workspace_settings (tutor_id)
  VALUES (_uid)
  ON CONFLICT (tutor_id) DO NOTHING;

  /* Drop any privileged / non-editable keys before merging. */
  _safe := _patch
    - 'subscription_status' - 'subscription_until' - 'current_plan'
    - 'independent_workspace' - 'liqpay_recurring_active' - 'liqpay_card_token'
    - 'trial_until' - 'tutor_id' - 'created_at' - 'updated_at';

  SELECT (jsonb_populate_record(t, _safe)).*
  INTO _merged
  FROM public.tutor_workspace_settings t
  WHERE t.tutor_id = _uid;

  UPDATE public.tutor_workspace_settings AS t SET
    ai_notes_auto              = _merged.ai_notes_auto,
    ai_notes_auto_send         = _merged.ai_notes_auto_send,
    auto_complete_lessons      = _merged.auto_complete_lessons,
    auto_complete_prompted     = _merged.auto_complete_prompted,
    cancel_fee_percent         = _merged.cancel_fee_percent,
    cancel_free_hours          = _merged.cancel_free_hours,
    custom_currencies          = _merged.custom_currencies,
    daily_digest_enabled       = _merged.daily_digest_enabled,
    free_reschedules_per_month = _merged.free_reschedules_per_month,
    marketing_opt_in           = _merged.marketing_opt_in,
    noshow_charge              = _merged.noshow_charge,
    notify_email               = _merged.notify_email,
    notify_telegram            = _merged.notify_telegram,
    onboarding_completed       = _merged.onboarding_completed,
    onboarding_step            = _merged.onboarding_step,
    payment_due_days           = _merged.payment_due_days,
    payment_due_mode           = _merged.payment_due_mode,
    payment_reminder_enabled   = _merged.payment_reminder_enabled,
    payment_rules_configured   = _merged.payment_rules_configured,
    reward_theme               = _merged.reward_theme,
    updated_at                 = now()
  WHERE t.tutor_id = _uid;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_workspace_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_workspace_settings(jsonb) TO authenticated;

/* 2. Remove ALL tutor write policies (every historical name; IF EXISTS = safe).
      Tutors keep "Tutor views own settings" (SELECT). Manager policies, the
      service role, and the SECURITY DEFINER RPCs (this one, grant_pro_days,
      set_own_independent_workspace) are untouched and continue to write. */
DROP POLICY IF EXISTS "Tutor inserts own settings"                   ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor updates own settings"                   ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor inserts own settings (non-independent)" ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor updates own settings (non-independent)" ON public.tutor_workspace_settings;

/* 3. Fresh 30-day trial for every existing tutor. They registered while the app was
      still in development and never really used it, so reset everyone to a clean
      30-day Pro trial. No paid subscribers exist; guard against clobbering any
      (hypothetical) active subscription. Runs in migration context (auth.uid() IS
      NULL) so the guard trigger allows it. */
UPDATE public.tutor_workspace_settings
SET subscription_status = 'trial',
    trial_until         = now() + interval '30 days',
    updated_at          = now()
WHERE subscription_status IS DISTINCT FROM 'active';
