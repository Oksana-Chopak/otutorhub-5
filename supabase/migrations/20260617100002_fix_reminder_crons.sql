-- ============================================================
-- FIX (P1): automated reminders silently never fire.
--  * payment-reminders-hourly posted Bearer current_setting('supabase.service_role_key')
--    (an unset GUC) but the function validates get_cron_shared_secret() → 403 every run.
--  * lesson-reminders (pre-lesson 60/15-min nudges) was never scheduled at all.
-- Reschedule both with the correct shared-secret scheme (as the digest crons use).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- payment-reminders: fix the auth header
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'payment-reminders-hourly';

SELECT cron.schedule(
  'payment-reminders-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- lesson-reminders: schedule every 5 minutes (the function expects this cadence)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'lesson-reminders-5min';

SELECT cron.schedule(
  'lesson-reminders-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/lesson-reminders',
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
  SELECT COUNT(*) INTO _c FROM cron.job WHERE jobname IN ('payment-reminders-hourly', 'lesson-reminders-5min');
  IF _c < 2 THEN RAISE WARNING 'reminder crons: expected 2, found %', _c; END IF;
END;
$$;
