/* ============================================================================
   Referral terms alignment (agreed model, binding):
     - referred FRIEND: 21-day Pro trial on signup via referral link
       (claim_referral granted 30 — every user-facing string already promises 21)
     - REFERRER: +1 month Pro per friend who actually PAYS (mark_referral_pro_upgrade,
       unchanged — already matches the model, incl. the +90d "3 paying friends in a
       calendar month" extra promo, intentionally kept)
   Also: get_referral_savings_uah still valued a Pro month at the retired 129 ₴ price;
   Pro is 249 ₴/mo (owner decision 2026-07-01, SubscriptionPage.PRO_PRICE_MONTHLY) —
   the "Заощаджено" stat on /my-referrals understated ~2x.

   NOT retroactive: friends who already claimed keep their 30-day trials (ledger rows
   and trial_until stay as granted). No clawback.

   Timestamp strictly above the latest applied migration (ordering trap — repo max is
   20260715000000). Idempotent (CREATE OR REPLACE only; no schema changes).
   ============================================================================ */

/* (1) claim_referral — body identical to the live 20260622000000 version except the
   friend's signup grant: 30 → 21 days. All anti-farming guards kept verbatim:
   auth required, no_code/invalid_code/self/already_referred early returns,
   referrals.referred_id UNIQUE one-claim-ever, tutor-role gate, NO referrer signup
   reward (referrer is rewarded only on the friend's first payment). */
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

  /* Only the referred friend gets the signup bonus — a 21-day Pro trial (agreed
     model; every user-facing string promises 21). The referrer is rewarded on the
     friend's first PAYMENT via mark_referral_pro_upgrade (anti-farming). */
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 21, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

/* (2) get_referral_savings_uah — value a bonus month at the current Pro price
   (249 ₴/mo), not the retired 129 ₴. Reason list unchanged. */
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
