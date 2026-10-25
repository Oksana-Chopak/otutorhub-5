/* ============================================================================
   Диск бази: журнал pg_cron з'їв 4,3 ГБ із 8 — прибирання і правило утримання
   (25.10)

   БІЗНЕС-ПРИЧИНА. Читальний запит на живій базі показав:
     УСЬОГО БАЗА                4546 MB
     cron.job_run_details       4368 MB   ← 96 % усієї бази
     net._http_response           83 MB   (514 рядків)
     auth.refresh_tokens / auth.sessions / public.job_runs   по 17–22 MB
   Lovable показує 5,62 ГБ із 8 доступних, і storage у Lovable можна збільшити,
   але НЕ зменшити. Тобто це не лише рядок у рахунку: до стіни лишалось ~2,4 ГБ,
   а коли диск Postgres заповнюється, база перестає приймати записи — застосунок
   не зміг би записати ні урок, ні оплату. Живим користувачам це видно одразу.

   ЩО ЦЕ ЗА ТАБЛИЦЯ. `cron.job_run_details` — власний журнал розширення pg_cron:
   рядок на КОЖЕН запуск кожного джоба, з повним текстом команди й відповіддю.
   Supabase його не прибирає сам. Продукт його не читає ніде: зведення
   «🛡 Нічні процеси» в ранковому дайджесті бере `public.job_runs` — нашу власну
   таблицю, яка тримає 30 днів і вже обрізається (міграція 20260927170000).
   Тобто втрата цієї історії не забирає жодної можливості діагностики.

   ЧОМУ TRUNCATE, А НЕ DELETE. DELETE не повертає місце операційній системі:
   рядки стають мертвими всередині того самого файла, і щоб файл зменшився,
   потрібен VACUUM FULL, якому треба ще стільки ж вільного місця — 4,3 ГБ, яких
   немає. TRUNCATE звільняє місце одразу, бо просто кидає файл. Це єдина
   операція, що тут справді допомагає.

   lock_timeout — щоб ця паста не могла підвиснути: якщо саме в цю мить якийсь
   джоб пише в журнал, вона чесно впаде за 5 секунд і нічого не змінить.

   Ідемпотентно: повторний прогін лише ще раз обріже вже порожнє.
   LIVE-MARKER-NONE: прибирання не має форми в types.ts. Доказ — рядок
   «УСЬОГО БАЗА» в запиті 8 стає ~250 МБ замість 4546 МБ, і джоб
   `cron-log-prune` стоїть у cron.job. Сценарій `71-cron-log-prune.sql`.
   ============================================================================ */

SET lock_timeout = '5s';

-- ── 1. Скільки займає ДО ────────────────────────────────────────────────────
DO $$
DECLARE sz text;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RAISE NOTICE 'cron.job_run_details немає — прибирати нічого';
  ELSE
    SELECT pg_size_pretty(pg_total_relation_size('cron.job_run_details')) INTO sz;
    RAISE NOTICE 'журнал pg_cron ДО прибирання: %', sz;
  END IF;
END $$;

-- ── 2. Прибрати журнал pg_cron ──────────────────────────────────────────────
-- Кількість рядків навмисно НЕ рахуємо: count(*) по таблиці на 4,3 ГБ — це
-- повний перебір, який на інстансі Mini (1 ГБ памʼяті) триватиме хвилини й
-- виглядатиме як «зависло». Розмір видно й без нього.
DO $$
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    TRUNCATE TABLE cron.job_run_details;
    RAISE NOTICE 'журнал pg_cron очищено';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'СТОП: немає права очистити cron.job_run_details. Нічого не змінено — скинь цей рядок Клоду';
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'СТОП: журнал зайнятий іншим процесом. Нічого не змінено — просто запусти пасту ще раз за хвилину';
END $$;

-- ── 3. Журнал відповідей pg_net — 83 МБ при 514 рядках, тобто великі тіла ───
-- pg_net тримає відповіді лише для читання одразу після запиту; усе, старше за
-- добу, не потрібне нікому. Таблиці може не бути (інша версія розширення) —
-- тоді просто пропускаємо, це не причина валити всю пасту.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN
    RAISE NOTICE 'net._http_response немає — пропускаю';
  ELSE
    DELETE FROM net._http_response WHERE created < now() - interval '1 day';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'journal pg_net: прибрано % рядків старших за добу', n;
  END IF;
EXCEPTION
  WHEN undefined_column OR insufficient_privilege THEN
    RAISE NOTICE 'net._http_response прибрати не вдалось (інша версія або права) — не критично, 83 МБ';
END $$;

-- ── 4. Правило утримання, щоб не наросло знову ──────────────────────────────
-- Два дні історії достатньо: за ніч видно, що впало, а наш власний journal
-- job_runs усе одно тримає 30 днів у формі, яку читає дайджест.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'cron-log-prune';
END $$;

SELECT cron.schedule(
  'cron-log-prune',
  '17 3 * * *',
  $cron$
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';
  $cron$
);

-- ── 5. Вбудована перевірка ──────────────────────────────────────────────────
DO $$
DECLARE n int; sz text;
BEGIN
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'cron-log-prune' AND schedule = '17 3 * * *';
  IF n <> 1 THEN RAISE EXCEPTION 'правило утримання не стало (знайдено %)', n; END IF;
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    SELECT pg_size_pretty(pg_total_relation_size('cron.job_run_details')) INTO sz;
    RAISE NOTICE '✔ журнал pg_cron ПІСЛЯ: %; щоночі о 03:17 лишатиметься 2 дні', sz;
  END IF;
  SELECT pg_size_pretty(pg_database_size(current_database())) INTO sz;
  RAISE NOTICE '✔ база разом тепер: %', sz;
END $$;
