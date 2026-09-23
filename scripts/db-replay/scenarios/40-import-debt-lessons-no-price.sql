-- Сценарій: імпорт «Олена — борг 2 уроки» БЕЗ ціни (скан Lovable 22.09 / 23.09).
-- Заявлено: рядок у превʼю з зеленою галочкою, а учень мовчки не створюється.
-- Факт із 13.09 (клієнт `ImportStudentsSheet`): для такого рядка клієнт шле
-- `_debt_lessons = 0` (борг уроками лишається словами в нотатці), тож RPC
-- МУСИТЬ створити учня. Тут перевіряємо обидва боки контракту: (1) виклик
-- рівно з тими аргументами, що шле клієнт, створює учня; (2) «сирий» виклик з
-- боргом уроками без ціни RPC відкидає гучно (DEBT_LESSONS_NEED_PRICE), а не
-- мовчки — саме на цю помилку клієнт і спирається. Виконується як РЕПЕТИТОР
-- (auth.uid() = самостійний репетитор на тріалі), не як суперкористувач.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  tutor uuid := gen_random_uuid();
  res jsonb;
  n int;
  caught text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (tutor, 'import-tutor@test.local', '{"first_name":"Імпорт","last_name":"Репетиторка","role":"tutor","independent_workspace":true}');
  UPDATE public.tutor_workspace_settings SET independent_workspace = true, subscription_status = 'trial', trial_until = now() + interval '30 days' WHERE tutor_id = tutor;
  IF NOT FOUND THEN RAISE EXCEPTION 'handle_new_user не створив workspace репетитора'; END IF;

  -- як PostgREST: запит від авторизованого репетитора
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- (1) рівно те, що шле клієнт для «Олена — борг 2 уроки» без ціни
  res := public.import_student_bundle(
    'Олена', '', '', '', '', 'Математика',
    0, 'UAH',
    0,      -- _debt_amount
    0,      -- _debt_lessons: клієнт ставить 0, борг уроками йде в нотатку
    0, 0, '{}'::timestamptz[], 60, NULL);
  IF res->>'student_id' IS NULL THEN RAISE EXCEPTION 'учня без ціни не створено: %', res; END IF;
  SELECT count(*) INTO n FROM public.profiles WHERE id = (res->>'student_id')::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'профіль учня не зʼявився'; END IF;
  SELECT count(*) INTO n FROM public.student_rates WHERE tutor_id = tutor AND student_id = (res->>'student_id')::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'пара репетитор–учень не створена'; END IF;

  -- (2) «сирий» борг уроками без ціни RPC відкидає ГУЧНО, не мовчки
  BEGIN
    PERFORM public.import_student_bundle('Тарас', '', '', '', '', 'Фізика', 0, 'UAH', 0, 2, 0, 0, '{}'::timestamptz[], 60, NULL);
    RAISE EXCEPTION 'RPC мовчки прийняв борг уроками без ціни — клієнт більше не має на що спертись';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS caught = MESSAGE_TEXT;
    IF caught <> 'DEBT_LESSONS_NEED_PRICE' THEN RAISE EXCEPTION 'несподівана помилка: %', caught; END IF;
  END;

  -- (3) борг уроками З ціною → борг рахується грошима
  res := public.import_student_bundle('Марго', '', '', '', '', 'Хімія', 350, 'UAH', 0, 2, 0, 0, '{}'::timestamptz[], 60, NULL);
  IF coalesce((res->>'debt_total')::numeric, 0) <> 700 THEN RAISE EXCEPTION 'борг 2 уроки × 350: очікували 700, є %', res->>'debt_total'; END IF;

  RAISE NOTICE '✅ імпорт: «борг 2 уроки» без ціни → учень створюється (клієнтський контракт) · сирий виклик відкидається гучно · з ціною борг = 700';
END $$;

ROLLBACK;
