-- Сценарій 69: Telegram ходить вебхуком, а крон лишився сторожем (25.10).
--
-- Що доводимо:
--   (1) після міграції є РІВНО один крон для Telegram — `telegram-webhook-watch`
--       на `*/5 * * * *`;
--   (2) жодного іншого джоба, що кличе `functions/v1/telegram-poll`, не лишилось
--       (саме хвилинний тримав довгий getUpdates і давав 409);
--   (3) сторож ходить із секретом із бази (`get_cron_shared_secret()`), а не з
--       вшитим значенням — інакше ротація секрету вбила б його мовчки;
--   (4) міграція ідемпотентна: другий прогін не плодить другого джоба.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE n int; cmd text;
BEGIN
  -- ── (1) один сторож на */5 ─────────────────────────────────────────────────
  SELECT count(*) INTO n FROM cron.job
   WHERE jobname = 'telegram-webhook-watch' AND schedule = '*/5 * * * *';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (1): сторожів на */5 — %, а має бути 1', n; END IF;
  RAISE NOTICE '✅ (1) один сторож вебхука на */5';

  -- ── (2) хвилинного опитування немає ───────────────────────────────────────
  SELECT count(*) INTO n FROM cron.job
   WHERE jobname <> 'telegram-webhook-watch'
     AND (command ILIKE '%functions/v1/telegram-poll%' OR jobname ILIKE '%telegram%');
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (2): лишилось % крон-джобів для Telegram', n; END IF;
  SELECT count(*) INTO n FROM cron.job WHERE schedule IN ('* * * * *', '*/1 * * * *');
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (2): у базі є хвилинний крон (%)', n; END IF;
  RAISE NOTICE '✅ (2) хвилинного крону немає ніде';

  -- ── (3) секрет береться з бази ────────────────────────────────────────────
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'telegram-webhook-watch';
  IF cmd IS NULL OR cmd NOT ILIKE '%get_cron_shared_secret()%' THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): сторож не читає секрет через get_cron_shared_secret()';
  END IF;
  IF cmd ~ '[0-9a-f]{64}' THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): у команді сторожа вшитий секрет — ротація його не підхопить';
  END IF;
  RAISE NOTICE '✅ (3) сторож ходить із секретом із бази, вшитого немає';
END $$;

-- ── (4) ідемпотентність: повторюємо кроки міграції ще раз ───────────────────
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN
    SELECT jobname FROM cron.job
     WHERE command ILIKE '%functions/v1/telegram-poll%' OR jobname ILIKE '%telegram%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
  PERFORM cron.schedule(
    'telegram-webhook-watch',
    '*/5 * * * *',
    $cron$SELECT net.http_post(
      url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/telegram-poll',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_cron_shared_secret()),
      body    := '{}'::jsonb) AS request_id;$cron$
  );
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'telegram-webhook-watch';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (4): після повтору сторожів %', n; END IF;
  RAISE NOTICE '✅ (4) повторний прогін не плодить другого джоба';
END $$;

ROLLBACK;
