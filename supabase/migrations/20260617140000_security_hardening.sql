-- Security hardening for 3 findings (idempotent; apply via Lovable):
--   1. lesson_details (wide, sensitive base table incl. tutor_payout / fireflies_*)
--      is on the supabase_realtime publication → remove it. Only the tutor's
--      FirefliesPanel needed it; the frontend switches to poll-while-pending.
--   2. Tutors can self-promote: the guard trigger's column list missed
--      current_plan / liqpay_recurring_active / liqpay_card_token. Re-install a
--      complete guard (service-role + manager bypass; an RPC for the legit
--      "go independent" opt-in). trial_until is intentionally NOT guarded
--      (claim_referral sets it as the tutor).
--   3. Security-definer views: the only intentional one is lesson_details_student
--      (it filters by student_id = auth.uid() and exposes only safe columns) —
--      documented exception. Re-assert the others as security_invoker (no-op).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Take the wide sensitive base table off the realtime bus.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lesson_details'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.lesson_details';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Complete the privilege-escalation guard on tutor_workspace_settings.
--    Blocks ONLY columns that have NO legitimate tutor path. trial_until is left
--    unguarded (claim_referral writes it as the tutor). LiqPay (service role,
--    auth.uid() IS NULL) and managers bypass. The "go independent" opt-in is
--    allowed only via the dedicated RPC below (transaction-local flag).
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Legitimate server-side Pro grants (referral bonus via claim_referral, 30-day
  -- streak via update_tutor_streak) run through grant_pro_days as the tutor
  -- (non-manager); grant_pro_days sets this transaction-local flag.
  IF current_setting('app.allow_grant_pro_days', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Tutor opting their OWN workspace into independent — only that one flag, only
  -- via set_own_independent_workspace() (which sets the transaction-local flag),
  -- and only when no subscription/billing column is touched in the same UPDATE.
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

-- Dedicated, safe way for a tutor to enable their OWN independent workspace.
CREATE OR REPLACE FUNCTION public.set_own_independent_workspace()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can enable an independent workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- transaction-local flag the guard honors (third arg = is_local)
  PERFORM set_config('app.allow_independent_optin', '1', true);
  UPDATE public.tutor_workspace_settings
    SET independent_workspace = true, onboarding_step = 0, updated_at = now()
    WHERE tutor_id = auth.uid();
END; $$;

REVOKE EXECUTE ON FUNCTION public.set_own_independent_workspace() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.set_own_independent_workspace() TO authenticated;

-- Re-create grant_pro_days with the transaction-local bypass flag so the guard above
-- lets its legitimate server-side subscription writes through (it runs as the tutor,
-- a non-manager, when invoked from claim_referral / update_tutor_streak).
CREATE OR REPLACE FUNCTION public.grant_pro_days(_tutor_id uuid, _days integer, _reason text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _settings record;
  _new_until timestamptz;
BEGIN
  PERFORM set_config('app.allow_grant_pro_days', '1', true);  -- transaction-local

  SELECT subscription_status, subscription_until, trial_until
  INTO _settings
  FROM public.tutor_workspace_settings
  WHERE tutor_id = _tutor_id;

  IF NOT FOUND THEN
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Re-assert the genuinely-invoker views (no-op if already set) and document the
--    one intentional definer view. lesson_details_student MUST stay definer: it is
--    the student-safe window (filters by student_id = auth.uid(), exposes only safe
--    columns) created when students' direct RLS on lesson_details was removed.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER VIEW IF EXISTS public.lessons_visible         SET (security_invoker = on);
ALTER VIEW IF EXISTS public.student_wallet_balances SET (security_invoker = on);
ALTER VIEW IF EXISTS public.tutor_public_details    SET (security_invoker = on);
COMMENT ON VIEW public.lesson_details_student IS
  'Intentional SECURITY DEFINER view: student-safe window over lesson_details, '
  'filtered by student_id = auth.uid(); exposes only non-sensitive columns '
  '(no tutor_payout, no fireflies transcript/recording). Linter "Security Definer '
  'View" is an accepted exception here.';
