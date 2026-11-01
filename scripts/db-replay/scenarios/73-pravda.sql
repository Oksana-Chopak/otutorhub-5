-- Сценарій: пакет «Правда» 01.11 (міграція 20261101120000_pravda).
--
-- Що доводимо:
--   (1) посилання на пару має короткий код з 8 знаків; повторне видавання — той
--       самий код; payment_link_for_pair віддає саме код;
--   (2) сторінка відкривається і за кодом, і за старим 64-символьним токеном;
--       перегляд подовжує термін; віддає next_lesson і short_code;
--   (3) «Я оплатив(ла)» → сповіщення з типом payment_claim_<id> (а не сталий тип,
--       який дедуп ковтав); друга заявка за день — окремий тип;
--   (4) кнопка бота: resolve_payment_claim_as під service role (auth.uid() порожній)
--       від імені репетитора підтверджує заявку канонічним шляхом (гаманець →
--       борг закрито); учень через неї підтвердити не може; з браузера функція
--       недоступна; сторінка показує last_claim = confirmed;
--   (5) лічильник «нагадано за вас» не рахує дзвіночок і undelivered, але рахує
--       telegram і share:*;
--   (6) tutor_value_stats повертає цифри пейволу.
-- ROLLBACK у кінці — база чиста.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  tutor uuid := gen_random_uuid();
  stu   uuid := gen_random_uuid();
  l1 uuid; l2 uuid; code text; tok text; res jsonb; res2 jsonb; claim uuid; n int; caught text; exp1 timestamptz; exp2 timestamptz;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (tutor, 't73@replay.local', '{"first_name":"Оксана","last_name":"Репетиторка","role":"tutor"}');
  PERFORM set_config('app.allow_independent_optin', '1', true);
  UPDATE public.tutor_workspace_settings SET independent_workspace = true, subscription_status = 'trial', trial_until = now() + interval '30 days' WHERE tutor_id = tutor;
  PERFORM set_config('app.allow_independent_optin', NULL, true);
  -- учень без акаунта (pending-профіль)
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (stu, 'Таня', 'Мамина', true);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source, payment_details)
    VALUES (tutor, stu, 'Математика', 500, 'UAH', 'independent', 'Монобанк 5375 0000 0000 0000');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() - interval '3 days', 60, 'completed', 'independent', tutor) RETURNING id INTO l1;
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() + interval '2 days', 60, 'scheduled', 'independent', tutor) RETURNING id INTO l2;
  UPDATE public.lesson_details SET student_price = 500, student_payment_status = 'unpaid' WHERE lesson_id = l1;

  -- ── (1) короткий код ────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.issue_payment_link(stu, NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  code := res->>'short_code'; tok := res->>'token';
  IF code IS NULL OR code !~ '^[a-z0-9]{8}$' THEN RAISE EXCEPTION 'ПРОВАЛ (1): короткого коду немає або формат не той: %', res; END IF;
  IF code ~ '[01lio]' THEN RAISE EXCEPTION 'ПРОВАЛ (1): у коді схожі символи: %', code; END IF;
  IF public.payment_link_for_pair(tutor, stu) <> code THEN RAISE EXCEPTION 'ПРОВАЛ (1): payment_link_for_pair дав інший код'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res2 := public.issue_payment_link(stu, NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res2->>'short_code' <> code THEN RAISE EXCEPTION 'ПРОВАЛ (1): повторне видавання змінило код'; END IF;
  IF NOT (res->>'student_pending')::boolean THEN RAISE EXCEPTION 'ПРОВАЛ (1): student_pending має бути true для pending-профілю'; END IF;
  RAISE NOTICE '✅ (1) короткий код % стабільний для пари', code;

  -- ── (2) сторінка за кодом і за токеном ──────────────────────────────────────
  SELECT expires_at INTO exp1 FROM public.payment_links WHERE short_code = code;
  UPDATE public.payment_links SET expires_at = now() + interval '3 days' WHERE short_code = code;
  res := public.payment_link_view(code);
  IF res->>'ok' <> 'true' OR (res->>'total')::numeric <> 500 THEN RAISE EXCEPTION 'ПРОВАЛ (2): сторінка за кодом: %', res; END IF;
  IF res->>'short_code' <> code OR res->'next_lesson'->>'subject' <> 'Математика' THEN RAISE EXCEPTION 'ПРОВАЛ (2): short_code/next_lesson: %', res; END IF;
  SELECT expires_at INTO exp2 FROM public.payment_links WHERE short_code = code;
  IF exp2 < now() + interval '170 days' THEN RAISE EXCEPTION 'ПРОВАЛ (2): перегляд не подовжив термін (%)', exp2; END IF;
  res2 := public.payment_link_view(tok);
  IF res2->>'ok' <> 'true' THEN RAISE EXCEPTION 'ПРОВАЛ (2): старий токен не відкриває сторінку: %', res2; END IF;
  res2 := public.payment_link_view('zzzzzzzz');
  IF res2->>'ok' <> 'false' THEN RAISE EXCEPTION 'ПРОВАЛ (2): чужий код відкрив сторінку'; END IF;
  RAISE NOTICE '✅ (2) сторінка відкривається за кодом і токеном, термін подовжується';

  -- ── (3) заявка → тип з id ──────────────────────────────────────────────────
  res := public.payment_link_claim(code, 500, 'з картки мами');
  IF res->>'ok' <> 'true' THEN RAISE EXCEPTION 'ПРОВАЛ (3): заявка не створилась: %', res; END IF;
  claim := (res->>'id')::uuid;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = tutor AND type = 'payment_claim_' || claim::text;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (3): сповіщення з типом payment_claim_<id> немає (%)', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = tutor AND type = 'payment_claim';
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (3): лишився сталий тип payment_claim'; END IF;
  RAISE NOTICE '✅ (3) заявка народила сповіщення payment_claim_%', claim;

  -- ── (4) кнопка бота: resolve_payment_claim_as ───────────────────────────────
  -- з браузера — ні
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  caught := NULL;
  BEGIN res := public.resolve_payment_claim_as(claim, true, tutor);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM; END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (4): resolve_payment_claim_as доступна з браузера'; END IF;
  -- під service role від імені учня — ні
  caught := NULL;
  BEGIN res := public.resolve_payment_claim_as(claim, true, stu);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM; END;
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (4): учень підтвердив собі заявку через бота'; END IF;
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'ПРОВАЛ (4): після невдалого виклику JWT-претензії не очистились'; END IF;
  -- від імені репетиторки — так, гроші канонічним шляхом
  res := public.resolve_payment_claim_as(claim, true, tutor);
  IF res->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'ПРОВАЛ (4): бот не підтвердив: %', res; END IF;
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'ПРОВАЛ (4): після виклику JWT-претензії лишились'; END IF;
  SELECT count(*) INTO n FROM public.pair_debt_lessons(tutor, stu);
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (4): борг не закрився після підтвердження з бота (%)', n; END IF;
  res := public.payment_link_view(code);
  IF res->'last_claim'->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'ПРОВАЛ (4): сторінка не показує «підтверджено»: %', res->'last_claim'; END IF;
  res := public.resolve_payment_claim_as(claim, true, tutor);
  IF res->>'reason' <> 'already_confirmed' THEN RAISE EXCEPTION 'ПРОВАЛ (4): повторний дотик не сказав «вже вирішено»: %', res; END IF;
  RAISE NOTICE '✅ (4) кнопка бота підтверджує канонічним шляхом; учень і браузер — ні';

  -- ── (5) лічильник — лише справжні канали ────────────────────────────────────
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() - interval '1 day', 60, 'completed', 'independent', tutor) RETURNING id INTO l1;
  UPDATE public.lesson_details SET student_price = 500, student_payment_status = 'unpaid' WHERE lesson_id = l1;
  INSERT INTO public.lesson_payment_reminders (lesson_id, tutor_id, student_id, reminder_kind, channel, sent_at) VALUES
    (l1, tutor, stu, 'manual', 'inapp', now() - interval '3 days'),
    (l1, tutor, stu, 'after_lesson', 'undelivered', now() - interval '2 days');
  res := public.tutor_reminder_stats(tutor);
  IF (res->>'reminded_times')::int <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (5): дзвіночок/undelivered порахувались як нагадування: %', res; END IF;
  INSERT INTO public.lesson_payment_reminders (lesson_id, tutor_id, student_id, reminder_kind, channel, sent_at) VALUES
    (l1, tutor, stu, 'manual', 'share:viber', now() - interval '1 day'),
    (l1, tutor, stu, 'after_lesson', 'telegram', now() - interval '1 day');
  res := public.tutor_reminder_stats(tutor);
  IF (res->>'reminded_times')::int <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (5): пересилання+telegram того ж дня мали дати 1, а є %', res; END IF;
  RAISE NOTICE '✅ (5) лічильник рахує лише доставлене';

  -- ── (6) цифри пейволу ───────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.tutor_value_stats(NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF (res->>'conducted_30d')::int <> 2 OR (res->>'reminded_times')::int <> 1 THEN
    RAISE EXCEPTION 'ПРОВАЛ (6): цифри пейволу: %', res;
  END IF;
  RAISE NOTICE '✅ (6) tutor_value_stats: %', res;
END $$;

ROLLBACK;
