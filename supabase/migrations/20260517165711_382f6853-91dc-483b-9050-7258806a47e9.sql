-- Referral rules update:
-- - Referral signup bonus: 7 → 30 days for BOTH referred and referrer
-- - Existing trials with <30 days remaining → extend to created_at + 30d

CREATE OR REPLACE FUNCTION public.claim_referral(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _referrer_id uuid;
  _new_user uuid := auth.uid();
  _existing uuid;
BEGIN
  IF _new_user IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_code');
  END IF;

  SELECT tutor_id INTO _referrer_id FROM public.referral_codes WHERE upper(code) = upper(trim(_code));
  IF _referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF _referrer_id = _new_user THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self');
  END IF;

  SELECT id INTO _existing FROM public.referrals WHERE referred_id = _new_user;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, code, signup_bonus_granted)
  VALUES (_referrer_id, _new_user, upper(trim(_code)), true);

  -- New rule: +30 days for BOTH friend and referrer at signup.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 30, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
    PERFORM public.grant_pro_days(_referrer_id, 30, 'referral_signup_referrer', jsonb_build_object('referred_id', _new_user));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

-- Backfill: extend active trials to at least 30 days from creation
UPDATE public.tutor_workspace_settings
SET trial_until = GREATEST(trial_until, created_at + interval '30 days')
WHERE subscription_status = 'trial'
  AND trial_until IS NOT NULL
  AND trial_until < now() + interval '30 days'
  AND trial_until > now();