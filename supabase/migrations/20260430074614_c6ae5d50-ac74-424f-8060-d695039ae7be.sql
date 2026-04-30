
-- =====================================================================
-- GAMIFICATION & REFERRAL SYSTEM
-- =====================================================================

-- 1. REFERRAL CODES (one per tutor)
CREATE TABLE public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_referral_codes_code ON public.referral_codes(lower(code));

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor views own code" ON public.referral_codes
  FOR SELECT TO authenticated USING (tutor_id = auth.uid());
CREATE POLICY "Tutor inserts own code" ON public.referral_codes
  FOR INSERT TO authenticated WITH CHECK (tutor_id = auth.uid() AND has_role(auth.uid(), 'tutor'::app_role));
CREATE POLICY "Manager manages all codes" ON public.referral_codes
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
-- Public can resolve a code to a tutor on the join landing page (only safe fields are exposed via select)
CREATE POLICY "Anyone can resolve code" ON public.referral_codes
  FOR SELECT TO anon, authenticated USING (true);

-- 2. REFERRALS (tracking signups + Pro upgrades)
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referred_id uuid NOT NULL UNIQUE,
  code text NOT NULL,
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  upgraded_to_pro_at timestamptz,
  signup_bonus_granted boolean NOT NULL DEFAULT false,
  pro_bonus_granted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_referrals_referrer ON public.referrals(referrer_id);
CREATE INDEX idx_referrals_referred ON public.referrals(referred_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor views own referrals" ON public.referrals
  FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR referred_id = auth.uid());
CREATE POLICY "Manager manages referrals" ON public.referrals
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- 3. TUTOR STREAKS (consecutive days with lessons)
CREATE TABLE public.tutor_streaks (
  tutor_id uuid PRIMARY KEY,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_lesson_date date,
  bonus_granted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor views own streak" ON public.tutor_streaks
  FOR SELECT TO authenticated USING (tutor_id = auth.uid());
CREATE POLICY "Manager views all streaks" ON public.tutor_streaks
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Manager manages streaks" ON public.tutor_streaks
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- 4. TUTOR BADGES (earned achievements)
CREATE TABLE public.tutor_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  badge_key text NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  UNIQUE(tutor_id, badge_key)
);
CREATE INDEX idx_tutor_badges_tutor ON public.tutor_badges(tutor_id);

ALTER TABLE public.tutor_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor views own badges" ON public.tutor_badges
  FOR SELECT TO authenticated USING (tutor_id = auth.uid());
CREATE POLICY "Manager views all badges" ON public.tutor_badges
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Manager manages badges" ON public.tutor_badges
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- 5. PRO BONUS LEDGER (audit trail of granted Pro days)
CREATE TABLE public.pro_bonus_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  days_granted integer NOT NULL,
  reason text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pro_bonus_ledger_tutor ON public.pro_bonus_ledger(tutor_id);

ALTER TABLE public.pro_bonus_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor views own bonuses" ON public.pro_bonus_ledger
  FOR SELECT TO authenticated USING (tutor_id = auth.uid());
CREATE POLICY "Manager views all bonuses" ON public.pro_bonus_ledger
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Generate a unique referral code (8 chars uppercase alphanumeric)
CREATE OR REPLACE FUNCTION public.generate_referral_code(_tutor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
  _existing text;
  _attempts int := 0;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _tutor_id AND NOT has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  -- Return existing if any
  SELECT code INTO _existing FROM public.referral_codes WHERE tutor_id = _tutor_id;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  LOOP
    _code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    BEGIN
      INSERT INTO public.referral_codes (tutor_id, code) VALUES (_tutor_id, _code);
      RETURN _code;
    EXCEPTION WHEN unique_violation THEN
      _attempts := _attempts + 1;
      IF _attempts > 10 THEN
        RAISE EXCEPTION 'Could not generate unique code';
      END IF;
    END;
  END LOOP;
END;
$$;

-- Grant Pro days by extending trial_until or subscription_until
CREATE OR REPLACE FUNCTION public.grant_pro_days(_tutor_id uuid, _days integer, _reason text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _settings record;
  _new_until timestamptz;
BEGIN
  SELECT subscription_status, subscription_until, trial_until
  INTO _settings
  FROM public.tutor_workspace_settings
  WHERE tutor_id = _tutor_id;

  IF NOT FOUND THEN
    -- Bootstrap settings row with trial
    INSERT INTO public.tutor_workspace_settings (tutor_id, subscription_status, trial_until)
    VALUES (_tutor_id, 'trial', now() + (_days || ' days')::interval);
  ELSE
    IF _settings.subscription_status = 'active' AND _settings.subscription_until IS NOT NULL THEN
      _new_until := GREATEST(_settings.subscription_until, now()) + (_days || ' days')::interval;
      UPDATE public.tutor_workspace_settings
      SET subscription_until = _new_until, updated_at = now()
      WHERE tutor_id = _tutor_id;
    ELSE
      _new_until := GREATEST(COALESCE(_settings.trial_until, now()), now()) + (_days || ' days')::interval;
      UPDATE public.tutor_workspace_settings
      SET subscription_status = CASE WHEN _settings.subscription_status = 'active' THEN 'active' ELSE 'trial' END,
          trial_until = _new_until,
          updated_at = now()
      WHERE tutor_id = _tutor_id;
    END IF;
  END IF;

  INSERT INTO public.pro_bonus_ledger (tutor_id, days_granted, reason, metadata)
  VALUES (_tutor_id, _days, _reason, _metadata);
END;
$$;

-- Claim a referral on signup (called from client right after signUp)
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

  -- Grant +7 days to both (only if new user is a tutor)
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _new_user AND role = 'tutor'::app_role) THEN
    PERFORM public.grant_pro_days(_new_user, 7, 'referral_signup_referred', jsonb_build_object('referrer_id', _referrer_id));
    PERFORM public.grant_pro_days(_referrer_id, 7, 'referral_signup_referrer', jsonb_build_object('referred_id', _new_user));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', _referrer_id);
END;
$$;

-- Mark referral as Pro-upgraded and reward referrer (+1 month). Called by webhook/manager.
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

  PERFORM public.grant_pro_days(_ref.referrer_id, 30, 'referral_pro_upgrade', jsonb_build_object('referred_id', _tutor_id));

  -- Check 3 pro upgrades within current calendar month → +1 year
  SELECT count(*) INTO _monthly_count
  FROM public.referrals
  WHERE referrer_id = _ref.referrer_id
    AND upgraded_to_pro_at >= date_trunc('month', now())
    AND upgraded_to_pro_at < date_trunc('month', now()) + interval '1 month';

  IF _monthly_count = 3 THEN
    PERFORM public.grant_pro_days(_ref.referrer_id, 365, 'referral_3_pro_in_month', '{}'::jsonb);
  END IF;
END;
$$;

-- Compute monthly stats for a tutor (lessons, on-time payment %, top X%)
CREATE OR REPLACE FUNCTION public.get_tutor_monthly_summary(_tutor_id uuid, _year int, _month int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz;
  _end timestamptz;
  _lessons_count int;
  _completed_count int;
  _paid_count int;
  _on_time_pct numeric;
  _all_tutors_counts int[];
  _rank int;
  _total_active int;
  _percentile int;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _tutor_id AND NOT has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _start := make_timestamptz(_year, _month, 1, 0, 0, 0);
  _end := _start + interval '1 month';

  SELECT count(*) FILTER (WHERE status IN ('completed','scheduled')),
         count(*) FILTER (WHERE status = 'completed'),
         count(*) FILTER (WHERE status = 'completed' AND student_payment_status = 'paid')
  INTO _lessons_count, _completed_count, _paid_count
  FROM public.lessons
  WHERE tutor_id = _tutor_id
    AND starts_at >= _start AND starts_at < _end;

  IF _completed_count > 0 THEN
    _on_time_pct := round((_paid_count::numeric / _completed_count::numeric) * 100);
  ELSE
    _on_time_pct := NULL;
  END IF;

  -- Top X% by completed lessons this month
  SELECT count(DISTINCT tutor_id) INTO _total_active
  FROM public.lessons
  WHERE starts_at >= _start AND starts_at < _end AND status = 'completed';

  IF _total_active > 0 AND _completed_count > 0 THEN
    SELECT count(*) + 1 INTO _rank
    FROM (
      SELECT tutor_id, count(*) AS c
      FROM public.lessons
      WHERE starts_at >= _start AND starts_at < _end AND status = 'completed'
      GROUP BY tutor_id
      HAVING count(*) > _completed_count
    ) sub;
    _percentile := GREATEST(1, ceil((_rank::numeric / _total_active::numeric) * 100)::int);
  ELSE
    _percentile := NULL;
  END IF;

  RETURN jsonb_build_object(
    'lessons_count', _lessons_count,
    'completed_count', _completed_count,
    'paid_count', _paid_count,
    'on_time_payment_pct', _on_time_pct,
    'top_percentile', _percentile,
    'total_active_tutors', _total_active,
    'year', _year,
    'month', _month
  );
END;
$$;

-- Get tutor level based on completed lessons + signals
CREATE OR REPLACE FUNCTION public.get_tutor_level(_tutor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _completed int;
  _referrals int;
  _is_pro boolean;
  _level_key text;
  _level_name text;
  _emoji text;
  _next_threshold int;
BEGIN
  SELECT count(*) INTO _completed FROM public.lessons WHERE tutor_id = _tutor_id AND status = 'completed';
  SELECT count(*) INTO _referrals FROM public.referrals WHERE referrer_id = _tutor_id AND pro_bonus_granted = true;
  SELECT is_tutor_pro(_tutor_id) INTO _is_pro;

  IF _completed >= 200 AND _is_pro THEN
    _level_key := 'pro_tutor'; _level_name := 'Про-репетитор'; _emoji := '👑'; _next_threshold := NULL;
  ELSIF _completed >= 100 AND _referrals >= 3 THEN
    _level_key := 'expert'; _level_name := 'Експерт'; _emoji := '🏆'; _next_threshold := 200;
  ELSIF _completed >= 50 THEN
    _level_key := 'master'; _level_name := 'Майстер'; _emoji := '⭐'; _next_threshold := 100;
  ELSIF _completed >= 10 THEN
    _level_key := 'practitioner'; _level_name := 'Практик'; _emoji := '📚'; _next_threshold := 50;
  ELSE
    _level_key := 'novice'; _level_name := 'Новачок'; _emoji := '🌱'; _next_threshold := 10;
  END IF;

  RETURN jsonb_build_object(
    'key', _level_key,
    'name', _level_name,
    'emoji', _emoji,
    'completed_lessons', _completed,
    'referrals_count', _referrals,
    'is_pro', _is_pro,
    'next_threshold', _next_threshold
  );
END;
$$;

-- Update streak on lesson completion (called via trigger)
CREATE OR REPLACE FUNCTION public.update_tutor_streak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := (NEW.starts_at AT TIME ZONE 'Europe/Kyiv')::date;
  _row record;
  _new_current int;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT * INTO _row FROM public.tutor_streaks WHERE tutor_id = NEW.tutor_id;
  IF NOT FOUND THEN
    INSERT INTO public.tutor_streaks (tutor_id, current_streak, longest_streak, last_lesson_date)
    VALUES (NEW.tutor_id, 1, 1, _today);
    RETURN NEW;
  END IF;

  IF _row.last_lesson_date = _today THEN
    RETURN NEW;
  ELSIF _row.last_lesson_date = _today - 1 THEN
    _new_current := _row.current_streak + 1;
  ELSE
    _new_current := 1;
  END IF;

  UPDATE public.tutor_streaks
  SET current_streak = _new_current,
      longest_streak = GREATEST(longest_streak, _new_current),
      last_lesson_date = _today,
      updated_at = now()
  WHERE tutor_id = NEW.tutor_id;

  -- Bonus: 30+ days streak gives +30 days Pro (once per streak achievement)
  IF _new_current >= 30 AND (_row.bonus_granted_at IS NULL OR _row.bonus_granted_at < now() - interval '30 days') THEN
    PERFORM public.grant_pro_days(NEW.tutor_id, 30, 'streak_30_days', jsonb_build_object('streak', _new_current));
    UPDATE public.tutor_streaks SET bonus_granted_at = now() WHERE tutor_id = NEW.tutor_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER lessons_update_streak
AFTER UPDATE OF status ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.update_tutor_streak();

-- Get monthly referral leaderboard (top tutors by Pro upgrades this month)
CREATE OR REPLACE FUNCTION public.get_referral_leaderboard(_year int, _month int)
RETURNS TABLE(referrer_id uuid, first_name text, last_name text, pro_upgrades int, total_signups int)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT make_timestamptz(_year, _month, 1, 0, 0, 0) AS s,
           make_timestamptz(_year, _month, 1, 0, 0, 0) + interval '1 month' AS e
  )
  SELECT r.referrer_id,
         p.first_name,
         p.last_name,
         count(*) FILTER (WHERE r.upgraded_to_pro_at >= b.s AND r.upgraded_to_pro_at < b.e)::int AS pro_upgrades,
         count(*) FILTER (WHERE r.signed_up_at    >= b.s AND r.signed_up_at    < b.e)::int AS total_signups
  FROM public.referrals r
  CROSS JOIN bounds b
  LEFT JOIN public.profiles p ON p.id = r.referrer_id
  GROUP BY r.referrer_id, p.first_name, p.last_name
  HAVING count(*) FILTER (WHERE r.signed_up_at >= b.s AND r.signed_up_at < b.e) > 0
  ORDER BY pro_upgrades DESC, total_signups DESC
  LIMIT 50;
$$;
