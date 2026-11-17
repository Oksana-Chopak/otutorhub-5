-- Сценарій 82: ПОСИЛАННЯ У СПОВІЩЕННІ — лише шлях усередині застосунку (17.11).
--
-- Знайдено на стенді: `create_notification` перевіряла «починається з / і не з //», а
-- `/\example.com` браузер читає як адресу чужого сайту. Дотик по такому сповіщенню виводив
-- людину з застосунку на чужий сайт. Сповіщення іншій людині може створити будь-хто з
-- акаунтом (учень — своєму репетиторові, сторонній — адміну платформи), тобто це готова
-- дорога для підробленої сторінки входу.
--
-- Що доводимо:
--   (1) правило: звичайні шляхи застосунку проходять; зворотна риска, подвійна риска,
--       табуляція / перенос рядка всередині, повна адреса, «javascript:» — ні;
--   (2) людина через справжню `create_notification` (під своєю роллю) не може покласти
--       небезпечне посилання: сповіщення доходить, посилання в ньому порожнє;
--   (3) пряма вставка службовою роллю (так пишуть edge-функції) — так само;
--   (4) зміна посилання заднім числом — так само;
--   (5) звичайне посилання лишається дослівно.
\set ON_ERROR_STOP on
SET client_min_messages = notice;
BEGIN;

DO $$
DECLARE
  stranger uuid := gen_random_uuid();
  admin_u uuid;
  bad text[] := ARRAY[
    E'/\\example.com', E'/\\\\example.com', '//example.com', E'/\t/example.com', E'/\n/example.com',
    'https://example.com/login', 'javascript:alert(1)', 'example.com', E'/schedule\\..\\x', ''
  ];
  good text[] := ARRAY[
    '/', '/schedule', '/schedule?lesson=7b0c1c1e-0000-4000-8000-000000000001', '/finances?tab=debts&remind=abc',
    '/people?open=abc&rate=1&subject=%D0%90%D0%BD%D0%B3%D0%BB', '/p/abcd2345', '/chats#last'
  ];
  x text; got text; id1 uuid;
BEGIN
  -- (1)
  FOREACH x IN ARRAY bad LOOP
    IF public.notification_link_is_safe(x) THEN RAISE EXCEPTION 'ПРОВАЛ (1): небезпечне посилання пройшло: %', quote_literal(x); END IF;
  END LOOP;
  FOREACH x IN ARRAY good LOOP
    IF NOT public.notification_link_is_safe(x) THEN RAISE EXCEPTION 'ПРОВАЛ (1): звичайний шлях відхилено: %', x; END IF;
  END LOOP;
  IF NOT public.notification_link_is_safe(NULL) THEN RAISE EXCEPTION 'ПРОВАЛ (1): сповіщення без посилання — це нормально'; END IF;
  RAISE NOTICE '✅ (1) правило: % небезпечних відхилено, % звичайних пройшло', array_length(bad, 1), array_length(good, 1);

  -- (2) сторонній → адміну платформи, справжнім RPC під роллю людини
  SELECT user_id INTO admin_u FROM platform_admins LIMIT 1;
  IF admin_u IS NULL THEN
    admin_u := gen_random_uuid();
    INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      VALUES (admin_u, 'q82-admin@test', now(), '{"first_name":"А","last_name":"А","role":"tutor","independent_workspace":true}'::jsonb);
    INSERT INTO platform_admins (user_id) VALUES (admin_u);
  END IF;
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    VALUES (stranger, 'q82-stranger@test', now(), '{"first_name":"С","last_name":"С","role":"tutor","independent_workspace":true}'::jsonb);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.create_notification(admin_u, 'q82_probe', 'Оплату підтверджено', 'Перевірте', E'/\\example.com/login');
  EXCEPTION WHEN OTHERS THEN
    -- RPC може й відмовити — це теж безпечно; головне, щоб небезпечне посилання не лягло в таблицю
    NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF EXISTS (SELECT 1 FROM notifications WHERE user_id = admin_u AND type = 'q82_probe' AND link IS NOT NULL) THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): людина поклала у сповіщення посилання на чужий сайт';
  END IF;
  RAISE NOTICE '✅ (2) через create_notification посилання на чужий сайт не лягає';

  -- (3) пряма вставка (так пишуть edge-функції й тригери)
  INSERT INTO notifications (user_id, type, title, body, link)
    VALUES (admin_u, 'q82_direct', 'т', 'т', E'/\t/example.com') RETURNING id, link INTO id1, got;
  IF got IS NOT NULL THEN RAISE EXCEPTION 'ПРОВАЛ (3): пряма вставка зберегла %', quote_literal(got); END IF;
  RAISE NOTICE '✅ (3) пряма вставка: небезпечне посилання стало порожнім, сповіщення лишилось';

  -- (4) зміна заднім числом
  UPDATE notifications SET link = '//example.com' WHERE id = id1 RETURNING link INTO got;
  IF got IS NOT NULL THEN RAISE EXCEPTION 'ПРОВАЛ (4): UPDATE зберіг %', got; END IF;
  RAISE NOTICE '✅ (4) зміна посилання заднім числом — так само';

  -- (5) звичайне посилання — дослівно
  UPDATE notifications SET link = '/finances?tab=debts&remind=abc' WHERE id = id1 RETURNING link INTO got;
  IF got IS DISTINCT FROM '/finances?tab=debts&remind=abc' THEN RAISE EXCEPTION 'ПРОВАЛ (5): звичайне посилання зіпсовано: %', got; END IF;
  RAISE NOTICE '✅ (5) звичайне посилання лишається дослівно';
END $$;

ROLLBACK;
