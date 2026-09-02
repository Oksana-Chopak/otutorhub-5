/* ============================================================================
   Реферальний бонус: 21 день → 1 МІСЯЦЬ (30 днів). Рішення власниці 02.09.2026.

   ЧОМУ. Раніше в продукті співіснували три різні числа: базовий тріал 30 днів,
   бонус запрошеному другу 21 день, бонус запрошувачу «місяць». Пояснити це
   користувачу в одному реченні неможливо, а «21 день» ще й читається як спроба
   зекономити. Тепер скрізь «місяць».

   НЕ РЕТРОАКТИВНО: у кого 21 день уже нараховано — лишається як є, нічого не
   віднімаємо (рядки pro_bonus_ledger і trial_until не чіпаються).

   Тіло функції — точна копія живої версії 20260716000000, змінене рівно одне
   число. Усі анти-фермерські перевірки збережені дослівно.

   Timestamp строго вище останньої міграції в репо (20260901120002) — інакше
   раннер Supabase мовчки пропустить файл (ordering trap).
   ============================================================================ */

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

  /* Тільки запрошений друг отримує бонус за реєстрацію — МІСЯЦЬ Pro (30 днів).
     Рішення власниці 02.09: «тріал не 21 день, а 1 місяць» — і тепер це одне й
     те саме число у трьох місцях: базовий тріал (handle_new_user, 30), бонус
     другу (тут, 30) і бонус запрошувачу за оплату друга (30, без змін).
     Запрошувач винагороджується на ПЕРШІЙ оплаті друга через
     mark_referral_pro_upgrade (захист від фермерства) — не змінено. */
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 30, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

/* Ціна місяця Pro для лічильника «Заощаджено» на /my-referrals: раніше 249 ₴
   (рішення 01.07), з 02.09 — 299 ₴. Формула та сама: дні / 30 × ціна місяця. */
CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 299 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_referral_savings_uah(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_referral_savings_uah(uuid) TO authenticated;
