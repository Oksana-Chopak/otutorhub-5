-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior version of this job
DO $$
DECLARE
  job_id integer;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'payment-reminders-hourly';
  IF FOUND THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END$$;

-- Schedule hourly invocation at minute 5
SELECT cron.schedule(
  'payment-reminders-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);