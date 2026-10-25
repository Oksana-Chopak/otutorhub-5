/* ============================================================================
   Telegram: вебхук замість опитування щохвилини (25.10)

   БІЗНЕС-ПРИЧИНА. Кнопки в боті («Нагадати», «Оплачено») — це гроші: людина
   тисне й чекає. Досі крон стріляв у `telegram-poll` РАЗ НА ХВИЛИНУ, і функція
   тримала довгий getUpdates до 55 с. Три наслідки, усі справжні:
     • натиснута кнопка могла чекати до хвилини, перш ніж її хтось побачить;
     • два запуски накладались, і Telegram віддавав 409 Conflict — той самий
       рядок ⚠, що з 30.09 світився в ранковому дайджесті;
     • 1440 запусків на добу лишали 1440 рядків у `job_runs`, і зведення
       «🛡 Нічні процеси» тонуло в них.

   Тепер Telegram стукає САМ, щойно є повідомлення: edge-функція піднімає
   вебхук і стежить, що він живий. Крон лишається, але рідкісний — він лише
   сторож вебхука: перевіряє, що адреса наша і що Telegram на неї не скаржиться
   (401/403 у last_error_message після ротації секрету), і піднімає назад.
   П'ять хвилин — це найдовше, скільки бот може молчати, якщо вебхук упав.

   ПОРЯДОК (як у 19.10): СПЕРШУ передеплой edge `telegram-poll` (вона вміє
   обидва шляхи й сама ставить вебхук), ПОТІМ ця паста. Якщо навпаки — нічого
   не ламається: стара функція просто опитує рідше, поки не доїде нова.

   ВІДКАТ без SQL: у коді `USE_WEBHOOK = false` → наступний запуск сторожа
   знімає вебхук і повертається до опитування.

   Ідемпотентно: unschedule + schedule повторювані, перевірка в кінці.
   LIVE-MARKER-NONE: крон не має форми в types.ts. Доказ — `cron.job`:
   `telegram-webhook-watch` на «кожні 5 хвилин» і жодного хвилинного;
   сценарій `69-telegram-webhook.sql`.
   ============================================================================ */

-- ── 1. Що стоїть зараз — у протокол, перед тим як щось рухати ────────────────
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT jobname, schedule FROM cron.job
     WHERE command ILIKE '%functions/v1/telegram-poll%' OR jobname ILIKE '%telegram%'
     ORDER BY jobname
  LOOP
    n := n + 1;
    RAISE NOTICE 'було: крон % на розкладі %', r.jobname, r.schedule;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'було: жодного крону для Telegram не знайдено (нічого знімати)';
  END IF;
END $$;

-- ── 2. Зняти ВСЕ, що кличе telegram-poll, яким би іменем воно не звалось ─────
-- Ім'я хвилинного джоба в репозиторії не записане (його створили поза ним), тож
-- шукаємо за ВМІСТОМ команди, а не за назвою.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobname FROM cron.job
     WHERE command ILIKE '%functions/v1/telegram-poll%' OR jobname ILIKE '%telegram%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
    RAISE NOTICE 'знято: %', r.jobname;
  END LOOP;
END $$;

-- ── 3. Один сторож вебхука, раз на 5 хвилин ─────────────────────────────────
SELECT cron.schedule(
  'telegram-webhook-watch',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/telegram-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- ── 4. Вбудована перевірка ──────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM cron.job
   WHERE jobname = 'telegram-webhook-watch' AND schedule = '*/5 * * * *';
  IF n <> 1 THEN
    RAISE EXCEPTION 'сторож вебхука не став на */5 (знайдено %)', n;
  END IF;
  SELECT count(*) INTO n FROM cron.job
   WHERE jobname <> 'telegram-webhook-watch'
     AND (command ILIKE '%functions/v1/telegram-poll%' OR jobname ILIKE '%telegram%');
  IF n <> 0 THEN
    RAISE EXCEPTION 'лишилось % зайвих крон-джобів для Telegram', n;
  END IF;
  RAISE NOTICE '✔ Telegram: один сторож вебхука на */5, хвилинного опитування немає';
END $$;
