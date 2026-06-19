ALTER TABLE public.student_details DROP COLUMN IF EXISTS tutor_notes;

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

  INSERT INTO public.tutor_workspace_settings (tutor_id)
  VALUES (_uid)
  ON CONFLICT (tutor_id) DO NOTHING;

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

DROP POLICY IF EXISTS "Tutor inserts own settings"                   ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor updates own settings"                   ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor inserts own settings (non-independent)" ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor updates own settings (non-independent)" ON public.tutor_workspace_settings;

UPDATE public.tutor_workspace_settings
SET subscription_status = 'trial',
    trial_until         = now() + interval '30 days',
    updated_at          = now()
WHERE subscription_status IS DISTINCT FROM 'active';