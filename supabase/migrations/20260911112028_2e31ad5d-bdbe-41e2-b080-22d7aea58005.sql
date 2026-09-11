DO $$
DECLARE
  job_id int;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'db-backup-nightly';
  IF FOUND THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END$$;

SELECT cron.schedule(
  'db-backup-nightly',
  '45 23 * * *',
  $$
  SELECT net.http_post(
    url := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/db-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);