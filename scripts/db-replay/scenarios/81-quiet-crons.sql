-- Сценарій 81: ТИХІ КРОНИ — edge-функцію будимо лише коли їй є що робити (17.11).
--
-- Запит власниці: «застосунок із трьома активними користувачами не має зʼїдати купу кредитів».
-- Три крони на «кожні 5 хвилин» давали 864 запуски edge-функцій на добу, майже всі — «робити
-- нічого». Міграція 20261117120000 ставить перед запуском дешеву перевірку в базі `cron_due`.
--
-- Що доводимо:
--   (1) частий крон (частіше ніж раз на 10 хвилин), що кличе edge-функцію, йде через `cron_due`;
--   (2) без уроків у вікні `cron_due` каже «ні» — функцію не будимо;
--   (3) урок у вікні функції → «так»: умова НЕ вужча за ту, якою функція сама відбирає уроки
--       (нагадування: від −48 год до +90 хв; Fireflies: від −5 до +10 хв), тож нічого не губиться;
--   (4) сповіщення репетиторам ставить база о 07:00 і 16:00 UTC з правильним вікном у тілі
--       (GitHub спізнювався на 6–8 годин: ранкові не йшли взагалі, вечірні приходили вночі);
--   (5) клієнт перевірку викликати не може.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE r record; n int; hb boolean; t uuid := gen_random_uuid(); s uuid := gen_random_uuid(); l uuid;
BEGIN
  -- (1)
  FOR r IN SELECT jobname, schedule, command FROM cron.job
            WHERE schedule ~ '^\*/[1-9] ' AND command LIKE '%functions/v1/%' LOOP
    IF r.command NOT LIKE '%cron_due(%' THEN
      RAISE EXCEPTION 'ПРОВАЛ (1): крон % (%) будить edge-функцію щоразу, без перевірки cron_due', r.jobname, r.schedule;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM cron.job WHERE command LIKE '%cron_due(%';
  IF n < 2 THEN RAISE EXCEPTION 'ПРОВАЛ (1): через cron_due йде лише % кронів, а має бути щонайменше 2', n; END IF;
  RAISE NOTICE '✅ (1) часті крони йдуть через перевірку «чи є що робити» (%)', n;

  -- серцебиття: у ці хвилини відповідь завжди «так» — від'ємну перевірку тоді пропускаємо
  hb := extract(minute FROM now()) < 5 AND extract(hour FROM now())::int % 6 = 0;

  -- (2) порожня база уроків
  IF EXISTS (SELECT 1 FROM lessons WHERE starts_at > now() - interval '49 hours' AND starts_at < now() + interval '92 minutes') THEN
    RAISE EXCEPTION 'фікстура: у базі сценарію вже є уроки у вікні';
  END IF;
  IF NOT hb AND (cron_due('lesson-reminders') OR cron_due('fireflies-auto-join')) THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): без уроків у вікні cron_due каже «так»';
  END IF;
  IF NOT cron_due('будь-що-інше') THEN RAISE EXCEPTION 'ПРОВАЛ (2): невідомий джоб мусить проходити (не глушимо те, чого не знаємо)'; END IF;
  RAISE NOTICE '✅ (2) без уроків у вікні edge-функції не будимо%', CASE WHEN hb THEN ' (зараз хвилина серцебиття — відʼємну гілку пропущено)' ELSE '' END;

  -- (3) урок у вікні
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (t, 'q81-t@test', now(), '{"first_name":"Т","last_name":"Т","role":"tutor","independent_workspace":true}'::jsonb),
    (s, 'q81-s@test', now(), '{"first_name":"У","last_name":"У","role":"student"}'::jsonb);
  INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
    VALUES (t, s, 'Англійська', now() + interval '80 minutes', 60, t, 'independent', 'scheduled') RETURNING id INTO l;
  IF NOT cron_due('lesson-reminders') THEN RAISE EXCEPTION 'ПРОВАЛ (3): урок через 80 хв — нагадування мусять прокинутись'; END IF;
  IF NOT hb AND cron_due('fireflies-auto-join') THEN RAISE EXCEPTION 'ПРОВАЛ (3): урок через 80 хв — Fireflies-боту ще рано'; END IF;
  UPDATE lessons SET starts_at = now() + interval '9 minutes' WHERE id = l;
  IF NOT cron_due('fireflies-auto-join') THEN RAISE EXCEPTION 'ПРОВАЛ (3): урок через 9 хв — Fireflies-бот мусить прокинутись'; END IF;
  UPDATE lessons SET starts_at = now() - interval '47 hours', status = 'completed' WHERE id = l;
  IF NOT cron_due('lesson-reminders') THEN RAISE EXCEPTION 'ПРОВАЛ (3): урок 47 годин тому — функція його ще читає («познач урок»)'; END IF;
  UPDATE lessons SET starts_at = now() - interval '50 hours' WHERE id = l;
  IF NOT hb AND cron_due('lesson-reminders') THEN RAISE EXCEPTION 'ПРОВАЛ (3): урок 50 годин тому — поза вікном функції'; END IF;
  RAISE NOTICE '✅ (3) урок у вікні функції будить її; поза вікном — ні';

  -- (4)
  SELECT count(*) INTO n FROM cron.job
   WHERE (jobname = 'notifications-morning' AND schedule = '0 7 * * *'  AND command LIKE '%scheduled-notifications%' AND command LIKE '%"window":"morning"%')
      OR (jobname = 'notifications-evening' AND schedule = '0 16 * * *' AND command LIKE '%scheduled-notifications%' AND command LIKE '%"window":"evening"%');
  IF n <> 2 THEN RAISE EXCEPTION 'ПРОВАЛ (4): сповіщення репетиторам у базі — % із 2', n; END IF;
  RAISE NOTICE '✅ (4) ранкові й вечірні сповіщення ставить база, з вікном у тілі запиту';

  -- (5)
  IF has_function_privilege('authenticated', 'public.cron_due(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cron_due(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ПРОВАЛ (5): cron_due доступна клієнту';
  END IF;
  RAISE NOTICE '✅ (5) перевірку викликає лише база';
END $$;

ROLLBACK;
