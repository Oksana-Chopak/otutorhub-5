-- ============================================================
-- CRON: payout-reminders — each morning, Telegram + web-push to the hub
-- manager(s) about tutor payouts due TODAY (per tutor_details.payout_* schedule).
-- 06:00 UTC ≈ 08:00–09:00 Kyiv. Same-day reminder. get_cron_shared_secret auth.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'payout-reminders-daily';

SELECT cron.schedule(
  'payout-reminders-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/payout-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

DO $$
DECLARE _c int;
BEGIN
  SELECT COUNT(*) INTO _c FROM cron.job WHERE jobname = 'payout-reminders-daily';
  IF _c < 1 THEN RAISE WARNING 'payout-reminders cron not registered'; END IF;
END;
$$;
