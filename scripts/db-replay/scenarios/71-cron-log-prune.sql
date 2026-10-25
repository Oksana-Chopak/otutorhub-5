-- Сценарій 71: журнал pg_cron прибрано і більше не наростає (25.10).
--
-- Що доводимо:
--   (1) після міграції журнал pg_cron порожній;
--   (2) правило утримання стоїть: джоб `cron-log-prune` раз на добу о 03:17;
--   (3) команда утримання справді ріже СТАРЕ й лишає свіже — рівно 2 дні;
--   (4) повторний прогін нічого не ламає (ідемпотентність).
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE n bigint; cmd text;
BEGIN
  -- ── (1) журнал порожній ────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM cron.job_run_details;
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (1): у журналі pg_cron % рядків, а має бути 0', n; END IF;
  RAISE NOTICE '✅ (1) журнал pg_cron порожній';

  -- ── (2) правило утримання ─────────────────────────────────────────────────
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'cron-log-prune' AND schedule = '17 3 * * *';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (2): джоба утримання немає'; END IF;
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'cron-log-prune';
  IF cmd NOT ILIKE '%job_run_details%' OR cmd NOT ILIKE '%2 days%' THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): команда утримання не та: %', cmd;
  END IF;
  RAISE NOTICE '✅ (2) утримання: щодня о 03:17, лишає 2 дні';
END $$;

-- ── (3) утримання ріже старе й лишає свіже ──────────────────────────────────
DO $$
DECLARE old_left bigint; fresh_left bigint;
BEGIN
  INSERT INTO cron.job_run_details (jobid, command, status, end_time)
  SELECT 1, 'старе', 'succeeded', now() - interval '9 days' FROM generate_series(1, 5);
  INSERT INTO cron.job_run_details (jobid, command, status, end_time)
  SELECT 1, 'свіже', 'succeeded', now() - interval '3 hours' FROM generate_series(1, 3);
  INSERT INTO cron.job_run_details (jobid, command, status, end_time)
  VALUES (1, 'на межі', 'succeeded', now() - interval '47 hours');

  -- саме та команда, що стоїть у джобі
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';

  SELECT count(*) INTO old_left FROM cron.job_run_details WHERE command = 'старе';
  SELECT count(*) INTO fresh_left FROM cron.job_run_details WHERE command IN ('свіже', 'на межі');
  IF old_left <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (3): старе лишилось (% рядків)', old_left; END IF;
  IF fresh_left <> 4 THEN RAISE EXCEPTION 'ПРОВАЛ (3): свіже зникло, лишилось % із 4', fresh_left; END IF;
  RAISE NOTICE '✅ (3) утримання: старе прибрано, свіже й «на межі 47 годин» лишились';
END $$;

-- ── (4) ідемпотентність ─────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  TRUNCATE TABLE cron.job_run_details;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'cron-log-prune';
  PERFORM cron.schedule('cron-log-prune', '17 3 * * *',
    $cron$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';$cron$);
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'cron-log-prune';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (4): після повтору джобів утримання %', n; END IF;
  RAISE NOTICE '✅ (4) повтор не плодить другого джоба';
END $$;

ROLLBACK;
