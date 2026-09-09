-- ============================================================================
-- Бекапи БД (рішення власниці 05.09, пункт 8 премортему).
--
-- 1) Приватний Storage-бакет `db-backups` — щоденні gzip-знімки бізнес-таблиць
--    (пише edge-функція db-backup під service role). ЖОДНОЇ політики на
--    storage.objects для нього НЕ створюємо: немає політики = немає доступу
--    жодній ролі, крім service role. Бекапи містять УСЕ (контакти, платежі),
--    тож будь-який арм тут був би витоком.
-- 2) pg_cron: щоночі о 23:45 UTC (01:45/02:45 за Києвом — поза активністю)
--    смикає функцію з cron-секретом — та сама схема, що lesson-reminders.
--
-- Ідемпотентно: ON CONFLICT для бакета, unschedule-якщо-є для крону.
--
-- LIVE-MARKER-NONE: бакети й cron.job не відображаються в types.ts.
-- Перевірка вручну: наступного ранку попроси Lovable глянути Storage →
-- db-backups → має лежати backup-YYYY-MM-DD.json.gz за сьогодні; або виклич
-- функцію db-backup вручну і подивись відповідь {ok:true, file:...}.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('db-backups', 'db-backups', false)
ON CONFLICT (id) DO UPDATE SET public = false;

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
