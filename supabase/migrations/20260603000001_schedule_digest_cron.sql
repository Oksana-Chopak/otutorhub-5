-- ============================================================
-- CRON: Schedule daily and weekly Telegram digests
-- daily:  every day at 06:00 UTC (08:00 EET / 09:00 EEST)
-- weekly: every Monday at 06:00 UTC
-- Both call edge functions authenticated via get_cron_shared_secret()
-- ============================================================

-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove old schedules if they exist (idempotent)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('tutor-daily-digest', 'tutor-weekly-digest');

-- Daily digest: every day at 06:00 UTC
SELECT cron.schedule(
  'tutor-daily-digest',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/tutor-daily-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Weekly digest: every Monday at 06:00 UTC
SELECT cron.schedule(
  'tutor-weekly-digest',
  '0 6 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/tutor-weekly-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verify schedules are registered
DO $$
DECLARE
  _count int;
BEGIN
  SELECT COUNT(*) INTO _count FROM cron.job
  WHERE jobname IN ('tutor-daily-digest', 'tutor-weekly-digest');
  IF _count < 2 THEN
    RAISE WARNING 'Expected 2 cron jobs, found %', _count;
  ELSE
    RAISE NOTICE 'Digest cron jobs registered: %', _count;
  END IF;
END;
$$;
