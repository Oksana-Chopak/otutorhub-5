
-- Update referral rules:
-- 1) Friend signs up → friend gets +7 days (on top of 14d trial = 21d). Referrer gets 0.
-- 2) Friend pays first month → referrer gets +30 days. (already in place)
-- 3) 3 referred friends pay in same calendar month → referrer gets +90 days (was 365).

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

  -- New rule: only friend (referred) gets +7 days bonus on top of base 14-day trial = 21 days.
  -- Referrer gets nothing at signup; rewarded only when friend pays.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 7, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_referral_pro_upgrade(_tutor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ref record;
  _monthly_count int;
BEGIN
  SELECT * INTO _ref FROM public.referrals WHERE referred_id = _tutor_id AND pro_bonus_granted = false;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.referrals
  SET upgraded_to_pro_at = now(), pro_bonus_granted = true
  WHERE id = _ref.id;

  -- Rule 2: +30 days to referrer when friend pays first month
  PERFORM public.grant_pro_days(_ref.referrer_id, 30, 'referral_pro_upgrade', jsonb_build_object('referred_id', _tutor_id));

  -- Rule 3: 3 paid friends in same calendar month → +90 extra days
  SELECT count(*) INTO _monthly_count
  FROM public.referrals
  WHERE referrer_id = _ref.referrer_id
    AND upgraded_to_pro_at >= date_trunc('month', now())
    AND upgraded_to_pro_at < date_trunc('month', now()) + interval '1 month';

  IF _monthly_count = 3 THEN
    PERFORM public.grant_pro_days(_ref.referrer_id, 90, 'referral_3_pro_in_month', '{}'::jsonb);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_referral_pro_upgrade(uuid) FROM anon, authenticated, public;

-- Helper: total UAH saved from referral bonuses (Pro = 129 UAH/month)
CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 129 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id
    AND reason IN ('referral_pro_upgrade', 'referral_3_pro_in_month', 'referral_signup_referrer');
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_savings_uah(uuid) TO authenticated;
