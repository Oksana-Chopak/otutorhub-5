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

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 21, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 249 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id
    AND reason IN ('referral_pro_upgrade', 'referral_3_pro_in_month', 'referral_signup_referrer');
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_savings_uah(uuid) TO authenticated;