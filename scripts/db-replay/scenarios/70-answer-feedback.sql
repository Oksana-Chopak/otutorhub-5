-- Сценарій: скринька звернень була в один бік (26.09).
-- Живе звернення від 14.09 «Есть ли у вас чат поддержки?» лежало без відповіді,
-- бо сторінка вміла лише міняти статус. answer_feedback() пише відповідь І
-- надсилає її автору сповіщенням. Перевіряємо чотири боки:
--   (1) суперадмін відповідає → текст збережено, статус resolved, сповіщення є;
--   (2) друга відповідь тій самій людині за ту саму добу ДОХОДИТЬ (саме цього не
--       вміла create_notification — дедуп по type за 24 години ковтав би її);
--   (3) анонімне звернення: відповідь збережена, delivered=false;
--   (4) звичайний користувач (не суперадмін) отримує відмову, і рядок не чіпається.
-- Усе — як PostgREST: від авторизованого користувача, не суперкористувачем.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  boss uuid := gen_random_uuid();   -- суперадмін платформи
  asker uuid := gen_random_uuid();  -- людина зі зверненням
  other uuid := gen_random_uuid();  -- сторонній користувач
  fb1 uuid; fb2 uuid;
  res jsonb;
  n int;
  caught text;
  answered text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (boss,  'boss@replay.local',  '{"first_name":"Бос","last_name":"Платформи"}'),
    (asker, 'asker@replay.local', '{"first_name":"Ернест","last_name":"Питальний"}'),
    (other, 'other@replay.local', '{"first_name":"Сторонній","last_name":"Юзер"}');
  -- Як у проді: власниця — і менеджер своєї школи, і адмін платформи. Саме цю
  -- пару вимагають політики читання скриньки, тож її вимагає і відповідь.
  INSERT INTO public.platform_admins (user_id) VALUES (boss) ON CONFLICT DO NOTHING;
  -- УВАГА (факт живої схеми): user_roles має UNIQUE (user_id) — рівно ОДНА роль
  -- на людину, і handle_new_user уже вставив 'student'. Тому роль МІНЯЄМО, а не
  -- додаємо: INSERT ... ON CONFLICT DO NOTHING тут тихо не робить нічого.
  UPDATE public.user_roles SET role = 'manager'::app_role WHERE user_id = boss;

  INSERT INTO public.feedback_submissions (user_id, category, message, status)
    VALUES (asker, 'question', 'Есть ли у вас чат поддержки?', 'new') RETURNING id INTO fb1;
  INSERT INTO public.feedback_submissions (user_id, category, message, status)
    VALUES (NULL, 'question', 'Анонімне питання', 'new') RETURNING id INTO fb2;

  -- (1) суперадмін відповідає
  PERFORM set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.answer_feedback(fb1, '  Так, є: меню → Допомога → Чат підтримки.  ');
  IF res->>'ok' <> 'true' OR res->>'delivered' <> 'true' THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): відповідь не надіслана: %', res;
  END IF;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT answer, status INTO answered, caught FROM public.feedback_submissions WHERE id = fb1;
  IF answered <> 'Так, є: меню → Допомога → Чат підтримки.' THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): текст не збережено або не обрізані пробіли: %', answered;
  END IF;
  IF caught <> 'resolved' THEN RAISE EXCEPTION 'ПРОВАЛ (1): статус лишився %', caught; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = asker AND type = 'feedback_reply';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (1): сповіщень % замість 1', n; END IF;
  RAISE NOTICE '✅ (1) відповідь збережена, статус resolved, сповіщення доставлено';

  -- (2) друга відповідь за ту саму добу мусить ДІЙТИ (дедуп create_notification тут не діє)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.answer_feedback(fb1, 'Доповнюю: там відповідає жива людина.');
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = asker AND type = 'feedback_reply';
  IF n <> 2 THEN RAISE EXCEPTION 'ПРОВАЛ (2): друга відповідь за добу не дійшла (сповіщень %)', n; END IF;
  RAISE NOTICE '✅ (2) друга відповідь за ту саму добу дійшла';

  -- (3) анонімне звернення: збережено, доставити нікуди
  PERFORM set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.answer_feedback(fb2, 'Відповідь на анонімне');
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res->>'ok' <> 'true' OR res->>'delivered' <> 'false' OR res->>'reason' <> 'anonymous' THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): анонімне звернення оброблено не так: %', res;
  END IF;
  SELECT answer INTO answered FROM public.feedback_submissions WHERE id = fb2;
  IF answered IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (3): відповідь на анонімне не збережено'; END IF;
  RAISE NOTICE '✅ (3) анонімне: відповідь збережена, delivered=false';

  -- (4) не суперадмін — відмова, і рядок не змінюється
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  caught := NULL;
  BEGIN
    res := public.answer_feedback(fb1, 'Я тут ні до чого');
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (4): сторонній зміг відповісти від імені підтримки'; END IF;
  SELECT answer INTO answered FROM public.feedback_submissions WHERE id = fb1;
  IF answered <> 'Доповнюю: там відповідає жива людина.' THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): сторонній змінив відповідь: %', answered;
  END IF;
  RAISE NOTICE '✅ (4) сторонньому відмовлено (%), рядок не змінено', left(caught, 40);

  -- (5) пряме оновлення колонок відповіді закрите грантом
  PERFORM set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  caught := NULL;
  BEGIN
    UPDATE public.feedback_submissions SET answer = 'напряму' WHERE id = fb1;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (5): відповідь можна записати напряму, без сповіщення'; END IF;
  RAISE NOTICE '✅ (5) пряма правка відповіді закрита (%)', left(caught, 40);
END $$;

ROLLBACK;
