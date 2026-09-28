-- Сценарій: мертвий вимикач (27.09) — журнал запусків cron-функцій і зведення.
-- (1) успішний і провальний запуски записуються з тривалістю, статусом, лічильниками;
-- (2) job_health рахує запуски/провали по процесу, віддає останню помилку і
--     останні лічильники УСПІШНОГО запуску (не провального);
-- (3) старі запуски (поза вікном) у зведення не потрапляють;
-- (4) з браузера журнал не читати і не писати.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  h jsonb;
  j jsonb;
BEGIN
  PERFORM public.job_run_record('tutor-daily-digest', true, 4200, 200, '{"sent": 41, "skipped": 2}'::jsonb, NULL);
  PERFORM public.job_run_record('tutor-daily-digest', false, 300, 500, NULL, 'TypeError: cannot read lessons');
  PERFORM public.job_run_record('db-backup', true, 9000, 200, '{"tables": 24, "bytes": 512000}'::jsonb, NULL);
  IF (SELECT count(*) FROM public.job_runs WHERE job = 'tutor-daily-digest') <> 2 THEN
    RAISE EXCEPTION '(1) записалось не два запуски дайджесту';
  END IF;
  IF (SELECT started_at FROM public.job_runs WHERE job = 'db-backup' LIMIT 1) > now() - interval '8 seconds' THEN
    RAISE EXCEPTION '(1) started_at не відлічено від тривалості';
  END IF;
  RAISE NOTICE '✅ (1) запуски записані з тривалістю, статусом і лічильниками';

  h := public.job_health(26);
  SELECT x INTO j FROM jsonb_array_elements(h) x WHERE x->>'job' = 'tutor-daily-digest';
  IF j IS NULL THEN RAISE EXCEPTION '(2) дайджесту немає у зведенні: %', h; END IF;
  IF (j->>'runs')::int <> 2 OR (j->>'failures')::int <> 1 THEN
    RAISE EXCEPTION '(2) runs/failures рахуються неправильно: %', j;
  END IF;
  IF j->>'last_error' NOT LIKE 'TypeError%' THEN RAISE EXCEPTION '(2) остання помилка не та: %', j; END IF;
  IF (j->'last_counts'->>'sent')::int <> 41 THEN
    RAISE EXCEPTION '(2) лічильники мають бути з останнього УСПІШНОГО запуску: %', j;
  END IF;
  IF j->>'last_ok_at' IS NULL THEN RAISE EXCEPTION '(2) last_ok_at порожній'; END IF;
  SELECT x INTO j FROM jsonb_array_elements(h) x WHERE x->>'job' = 'db-backup';
  IF (j->>'failures')::int <> 0 OR (j->'last_counts'->>'tables')::int <> 24 THEN
    RAISE EXCEPTION '(2) бекап у зведенні неправильний: %', j;
  END IF;
  RAISE NOTICE '✅ (2) зведення: запуски, провали, остання помилка, лічильники з останнього успішного';

  UPDATE public.job_runs SET started_at = now() - interval '3 days', finished_at = now() - interval '3 days' WHERE job = 'db-backup';
  h := public.job_health(26);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(h) x WHERE x->>'job' = 'db-backup') THEN
    RAISE EXCEPTION '(3) запуск триденної давнини потрапив у добове зведення — «не запускався» не буде видно';
  END IF;
  RAISE NOTICE '✅ (3) запуск поза вікном у зведення не потрапляє — мовчання процесу стає видимим';

  IF has_function_privilege('authenticated', 'public.job_health(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.job_run_record(text, boolean, integer, integer, jsonb, text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.job_runs', 'SELECT')
     OR has_table_privilege('anon', 'public.job_runs', 'SELECT') THEN
    RAISE EXCEPTION '(4) журнал запусків доступний з браузера';
  END IF;
  RAISE NOTICE '✅ (4) журнал і зведення — лише для service_role';
END $$;

ROLLBACK;
