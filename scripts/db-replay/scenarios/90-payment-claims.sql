-- Сценарій: «Я оплатив» — заявка учня і підтвердження того, хто отримує гроші
-- (важіль 4 аудиту шляхів 24.09, рішення власниці «заявка + підтвердження»).
-- Перевіряємо сім боків:
--   (1) учень самостійного репетитора створює заявку → репетитор отримує сповіщення;
--   (2) друга кнопка не створює другої заявки (одна «в очікуванні» на пару);
--   (3) заявку до ЧУЖОГО репетитора створити не можна (анти-спам);
--   (4) підтвердження = канонічний шлях грошей: гаманець + автозакриття боргу;
--   (5) учень не може підтвердити собі заявку сам;
--   (6) відмова лишає гроші недоторканими і каже учню словами;
--   (7) пара ШКОЛИ: заявку бачить менеджер, він її й підтверджує (хабовий
--       репетитор грошей не записує).
-- Усе — як PostgREST: від авторизованого користувача, не суперкористувачем.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  ind uuid := gen_random_uuid();    -- самостійний репетитор
  stu uuid := gen_random_uuid();    -- його учень
  mgr uuid := gen_random_uuid();    -- менеджер школи
  hub uuid := gen_random_uuid();    -- хабовий репетитор
  hstu uuid := gen_random_uuid();   -- учень школи
  other uuid := gen_random_uuid();  -- сторонній репетитор
  hubid uuid;
  res jsonb; claim uuid; n int; caught text; bal record; paid text;
  lesson uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (ind,   'i90@replay.local', '{"first_name":"Само","last_name":"Стійна","role":"tutor"}'),
    (stu,   's90@replay.local', '{"first_name":"Оля","last_name":"Учениця"}'),
    (mgr,   'm90@replay.local', '{"first_name":"Мен","last_name":"Еджер","role":"tutor"}'),
    (hub,   'h90@replay.local', '{"first_name":"Хаб","last_name":"Репетитор","role":"tutor"}'),
    (hstu,  'q90@replay.local', '{"first_name":"Тимур","last_name":"Школяр"}'),
    (other, 'o90@replay.local', '{"first_name":"Чужий","last_name":"Репетитор","role":"tutor"}');

  -- самостійна пара: ставка + проведений неоплачений урок на 700.
  -- УВАГА: hub_id у рядка налаштувань лишається від тригера set_default_hub_id
  -- (єдина школа в базі) — саме так виглядають ЖИВІ дані. Персону мусить
  -- визначати прапорець independent_workspace, і сценарій це перевіряє.
  PERFORM set_config('app.allow_independent_optin', '1', true);
  UPDATE public.tutor_workspace_settings SET independent_workspace = true WHERE tutor_id = ind;
  PERFORM set_config('app.allow_independent_optin', NULL, true);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (ind, stu, 'Математика', 700, 'UAH', 'independent');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (ind, stu, 'Математика', now() - interval '2 days', 60, 'completed', 'independent', ind)
    RETURNING id INTO lesson;
  UPDATE public.lesson_details SET student_price = 700, student_payment_status = 'unpaid' WHERE lesson_id = lesson;

  -- школа: менеджер, хабовий репетитор, його учень
  PERFORM set_config('app.allow_manager_role', '1', true);
  UPDATE public.user_roles SET role = 'manager'::app_role WHERE user_id = mgr;
  INSERT INTO public.hubs (name) VALUES ('Школа 90') RETURNING id INTO hubid;
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hubid, mgr) ON CONFLICT DO NOTHING;
  PERFORM set_config('app.allow_manager_role', NULL, true);
  UPDATE public.tutor_workspace_settings SET hub_id = hubid, independent_workspace = false WHERE tutor_id = hub;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hubid, hstu) ON CONFLICT DO NOTHING;
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (hub, hstu, 'Англійська', 500, 'UAH', 'hub');

  -- ── (1) учень створює заявку ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.create_payment_claim(ind, 700, 'переказала на монобанк');
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res->>'ok' <> 'true' THEN RAISE EXCEPTION 'ПРОВАЛ (1): заявка не створилась: %', res; END IF;
  claim := (res->>'id')::uuid;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = ind AND type = 'payment_claim';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (1): репетитор не отримав сповіщення (%)', n; END IF;
  RAISE NOTICE '✅ (1) заявка створена, репетитор отримав сповіщення';

  -- ── (2) друга кнопка — та сама заявка ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.create_payment_claim(ind, 700, NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res->>'reason' <> 'already_pending' OR (res->>'id')::uuid <> claim THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): другий дотик створив другу заявку: %', res;
  END IF;
  SELECT count(*) INTO n FROM public.payment_claims WHERE student_id = stu;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (2): заявок % замість 1', n; END IF;
  RAISE NOTICE '✅ (2) друга кнопка повертає ту саму заявку';

  -- ── (3) чужий репетитор — ні ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  caught := NULL;
  BEGIN res := public.create_payment_claim(other, 100, NULL);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM; END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (3): заявку до чужого репетитора прийняли'; END IF;
  RAISE NOTICE '✅ (3) до чужого репетитора заявку не створити (%)', left(caught, 30);

  -- ── (5) учень не підтверджує сам собі (перевіряємо ДО підтвердження) ───────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  caught := NULL;
  BEGIN res := public.resolve_payment_claim(claim, true);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM; END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (5): учень підтвердив собі оплату сам'; END IF;
  SELECT student_payment_status INTO paid FROM public.lesson_details WHERE lesson_id = lesson;
  IF paid <> 'unpaid' THEN RAISE EXCEPTION 'ПРОВАЛ (5): урок став оплаченим без підтвердження'; END IF;
  RAISE NOTICE '✅ (5) учень підтвердити не може, гроші не зрушили';

  -- ── (4) репетитор підтверджує → гаманець + автозакриття боргу ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ind, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.resolve_payment_claim(claim, true);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'ПРОВАЛ (4): підтвердження не пройшло: %', res; END IF;
  SELECT student_payment_status INTO paid FROM public.lesson_details WHERE lesson_id = lesson;
  IF paid <> 'paid' THEN RAISE EXCEPTION 'ПРОВАЛ (4): борг не закрився кредитом гаманця (%)', paid; END IF;
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  IF COALESCE(bal.amount_balance, 0) <> 0 THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): після закриття уроку на 700 лишок мусив бути 0, а він %', bal.amount_balance;
  END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = stu AND type = 'payment_confirmed';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (4): учень не почув «підтверджено» (%)', n; END IF;
  RAISE NOTICE '✅ (4) підтвердження записало гроші канонічним шляхом і закрило борг';

  -- ── (6) відмова: гроші недоторкані, учень чує словами ──────────────────────
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (ind, stu, 'Математика', now() - interval '1 day', 60, 'completed', 'independent', ind)
    RETURNING id INTO lesson;
  UPDATE public.lesson_details SET student_price = 700, student_payment_status = 'unpaid' WHERE lesson_id = lesson;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.create_payment_claim(ind, 700, NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  claim := (res->>'id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ind, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.resolve_payment_claim(claim, false);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res->>'status' <> 'rejected' THEN RAISE EXCEPTION 'ПРОВАЛ (6): відмова не записалась: %', res; END IF;
  SELECT student_payment_status INTO paid FROM public.lesson_details WHERE lesson_id = lesson;
  IF paid <> 'unpaid' THEN RAISE EXCEPTION 'ПРОВАЛ (6): після відмови урок став оплаченим'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = stu AND type = 'payment_claim_rejected';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (6): учень не почув про відмову'; END IF;
  RAISE NOTICE '✅ (6) відмова нічого не записала і сказала учню словами';

  -- ── (7) пара ШКОЛИ: заявку підтверджує менеджер, не хабовий репетитор ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hstu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.create_payment_claim(hub, 500, NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  claim := (res->>'id')::uuid;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = mgr AND type = 'payment_claim';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (7): менеджер школи не отримав заявку (%)', n; END IF;
  -- хабовий репетитор грошей не записує — підтвердити не може
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hub, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  caught := NULL;
  BEGIN res := public.resolve_payment_claim(claim, true);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM; END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (7): хабовий репетитор записав гроші школи'; END IF;
  -- а менеджер — може
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.resolve_payment_claim(claim, true);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'ПРОВАЛ (7): менеджер не зміг підтвердити: %', res; END IF;
  RAISE NOTICE '✅ (7) школа: заявку бачить і підтверджує менеджер, хабовому відмовлено';
END $$;

ROLLBACK;
