/* ============================================================================
   Pre-release hardening: referral farming + notification spoofing/phishing.
   Timestamp above the latest applied (ordering trap). Idempotent (CREATE OR REPLACE).
   ============================================================================ */

/* (A) HIGH: referral signup farming. claim_referral granted the REFERRER +30 Pro days
   per signup with no cap → unlimited free Pro via throwaway accounts. Remove the
   referrer's SIGNUP reward; the referrer is rewarded only when the friend actually PAYS
   (mark_referral_pro_upgrade, called from the LiqPay + RevenueCat callbacks) — which is
   the documented business rule ("1 month per friend who SUBSCRIBES"). The referred
   friend still gets the one-time +30 signup bonus (bounded by referrals.referred_id
   UNIQUE). Body identical to 20260517165711 except the referrer grant line is dropped. */
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

  /* Only the referred friend gets the signup bonus. The referrer is rewarded on the
     friend's first PAYMENT via mark_referral_pro_upgrade (anti-farming). */
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 30, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

/* (B) HIGH: create_notification let ANY authenticated user push a notification (+ Web
   Push) to ANY user with attacker-controlled title/body/link. Add (1) a relationship
   authorization gate so a caller can only notify users they actually relate to, and
   (2) link validation that rejects non-relative links (anti open-redirect/phishing —
   paired with the sw.js same-origin sanitizer). */
CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id uuid,
  _type    text,
  _title   text,
  _body    text DEFAULT NULL,
  _link    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing uuid;
  _new_id   uuid;
  _caller   uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  IF _user_id IS NULL OR _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'user_id, type and title are required';
  END IF;

  /* Link must be a relative same-origin path (leading single slash). Blocks
     http(s)://, protocol-relative //evil, and javascript: links. */
  IF _link IS NOT NULL AND (left(_link, 1) <> '/' OR left(_link, 2) = '//') THEN
    RAISE EXCEPTION 'notification link must be a relative path' USING ERRCODE = 'check_violation';
  END IF;

  /* Authorization: only notify a user you relate to — self, a manager (managers may
     notify anyone; anyone may notify a manager for support/requests), or a shared
     tutor↔student relationship (rate, lesson, group enrollment, or chat thread). */
  IF NOT (
    _caller = _user_id
    OR public.has_role(_caller, 'manager'::app_role)
    OR public.has_role(_user_id, 'manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.student_rates r
      WHERE (r.tutor_id = _caller AND r.student_id = _user_id)
         OR (r.student_id = _caller AND r.tutor_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE (l.tutor_id = _caller AND l.student_id = _user_id)
         OR (l.student_id = _caller AND l.tutor_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.lesson_groups g
      JOIN public.group_enrollments ge ON ge.group_id = g.id
      WHERE g.tutor_id = _caller AND ge.student_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE (t.tutor_id = _caller AND t.student_id = _user_id)
         OR (t.student_id = _caller AND t.tutor_id = _user_id)
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to notify this user' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Dedup: skip if the same user+type was notified within the last 24h.
  SELECT id INTO _existing
    FROM public.notifications
   WHERE user_id = _user_id
     AND type = _type
     AND created_at >= now() - interval '24 hours'
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_user_id, _type, _title, _body, _link)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text) TO authenticated;

/* (C) notify_managers fans to every manager. It routes through create_notification (so
   the link check above also applies), but add an explicit link check here too as
   defense-in-depth. Manager fan-out is intended (support/requests); the dangerous part
   was the link, now neutralized server-side + in sw.js. */
CREATE OR REPLACE FUNCTION public.notify_managers(
  _type  text,
  _title text,
  _body  text DEFAULT NULL,
  _link  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _m     record;
  _count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'type and title are required';
  END IF;
  IF _link IS NOT NULL AND (left(_link, 1) <> '/' OR left(_link, 2) = '//') THEN
    RAISE EXCEPTION 'notification link must be a relative path' USING ERRCODE = 'check_violation';
  END IF;

  FOR _m IN
    SELECT DISTINCT user_id
      FROM public.user_roles
     WHERE role = 'manager'::app_role
  LOOP
    PERFORM public.create_notification(_m.user_id, _type, _title, _body, _link);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;
REVOKE ALL  ON FUNCTION public.notify_managers(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_managers(text, text, text, text) TO authenticated;
