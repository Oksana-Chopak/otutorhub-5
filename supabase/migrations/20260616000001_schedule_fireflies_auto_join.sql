-- ============================================================
-- CRON: fireflies-auto-join — start recording for lessons about to begin
-- whose tutor enabled ai_notes_auto. Runs every 5 minutes.
-- Authenticated via get_cron_shared_secret() (same scheme as the digests).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: drop an existing schedule before re-creating.
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'fireflies-auto-join';

SELECT cron.schedule(
  'fireflies-auto-join',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/fireflies-auto-join',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

DO $$
DECLARE
  _count int;
BEGIN
  SELECT COUNT(*) INTO _count FROM cron.job WHERE jobname = 'fireflies-auto-join';
  IF _count < 1 THEN
    RAISE WARNING 'fireflies-auto-join cron not registered';
  ELSE
    RAISE NOTICE 'fireflies-auto-join cron registered';
  END IF;
END;
$$;
