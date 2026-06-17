-- ============================================================
-- FIX (P0): paid Pro never expired server-side. liqpay-callback sets
-- subscription_status='active' + subscription_until but nothing flips it back,
-- so a failed/lapsed LiqPay renewal = free Pro forever. Add a daily downgrade so
-- the DB state matches reality (gates already harden client+server-side).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.tutor_workspace_settings
     SET subscription_status = 'past_due'
   WHERE subscription_status = 'active'
     AND subscription_until IS NOT NULL
     AND subscription_until < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'expire-lapsed-subscriptions';

SELECT cron.schedule(
  'expire-lapsed-subscriptions',
  '0 3 * * *',
  $$ SELECT public.expire_lapsed_subscriptions(); $$
);
