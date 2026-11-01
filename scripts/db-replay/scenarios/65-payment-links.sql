-- Сценарій: нагадування БЕЗ акаунта учня — магічне посилання на публічну
-- сторінку оплати (13.10, пре-мортем: «обіцянка «ви не нагадуєте» працювала
-- лише для зареєстрованого учня з Telegram»).
-- Перевіряємо:
--   (1) репетитор видає посилання для pending-учня (без auth.users) — отримує
--       токен, кількість боргових уроків і суму за канонічним предикатом боргу;
--   (2) повторний виклик віддає ТОЙ САМИЙ токен (одне посилання на пару);
--   (3) чужий репетитор посилання на чужого учня не отримає;
--   (4) публічний перегляд (service role): імʼя без прізвища, уроки, сума,
--       реквізити, лічильник переглядів; лише проведене й неоплачене;
--   (5) «Я оплатив(ла)» з посилання створює заявку pending-учня (FK на profiles),
--       репетитор отримує сповіщення; друга — та сама заявка;
--   (6) стеля 3 заявки на добу з посилання;
--   (7) репетитор підтверджує заявку канонічним шляхом — борг закрито;
--   (8) відкликане/прострочене посилання не читається і не приймає заявок;
--   (9) «переслав сам» лишає слід у журналі нагадувань (канал share:*),
--       повторне пересилання не падає на ключі журналу;
--  (10) з браузера (authenticated) функції перегляду/заявки/службового токена
--       недоступні — лише службова роль.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  tutor uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  stu uuid := gen_random_uuid();         -- pending-учень: лише profiles, без auth.users
  l_done uuid; l_future uuid; l_paid uuid; l_fee uuid;
  res jsonb; res2 jsonb; tok text; n int; caught text; v_views int; claim uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (tutor, 't65@replay.local', '{"first_name":"Ірина","last_name":"Репетитор","role":"tutor"}'),
    (other, 'o65@replay.local', '{"first_name":"Чужий","last_name":"Репетитор","role":"tutor"}');
  PERFORM set_config('app.allow_independent_optin', '1', true);
  UPDATE public.tutor_workspace_settings SET independent_workspace = true WHERE tutor_id IN (tutor, other);
  PERFORM set_config('app.allow_independent_optin', NULL, true);

  -- pending-учень без акаунта — як add_or_link_independent_student
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (stu, 'Оля', 'Коваль', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (stu, 'student'::app_role);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source, payment_details)
    VALUES (tutor, stu, 'Математика', 500, 'UAH', 'independent', 'Монобанк 5375 4141 0000 1234');

  -- уроки: 2 проведені неоплачені (борг), 1 майбутній (не борг), 1 проведений оплачений,
  -- 1 скасований зі штрафом (борг за моделлю 04.09)
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() - interval '5 days', 60, 'completed', 'independent', tutor) RETURNING id INTO l_done;
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() - interval '2 days', 60, 'completed', 'independent', tutor) RETURNING id INTO l_paid;
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() + interval '2 days', 60, 'scheduled', 'independent', tutor) RETURNING id INTO l_future;
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() - interval '9 days', 60, 'cancelled', 'independent', tutor) RETURNING id INTO l_fee;
  UPDATE public.lesson_details SET student_price = 500, student_payment_status = 'unpaid' WHERE lesson_id IN (l_done, l_future);
  UPDATE public.lesson_details SET student_price = 500, student_payment_status = 'paid', student_paid_at = now() WHERE lesson_id = l_paid;
  UPDATE public.lesson_details SET student_price = 250, student_payment_status = 'unpaid', is_cancellation_fee = true WHERE lesson_id = l_fee;

  -- ── (1) репетитор видає посилання ───────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.issue_payment_link(stu, NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  tok := res->>'token';
  IF tok IS NULL OR length(tok) < 48 THEN RAISE EXCEPTION 'ПРОВАЛ (1): токена немає: %', res; END IF;
  IF (res->>'lessons')::int <> 2 OR (res->>'total')::numeric <> 750 THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): борг пари мав бути 2 уроки на 750 (проведений 500 + штраф 250), а є %', res;
  END IF;
  IF res->>'student_first_name' <> 'Оля' OR (res->>'telegram')::boolean OR (res->>'email')::boolean OR NOT (res->>'has_requisites')::boolean THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): імʼя/канали неправильні: %', res;
  END IF;
  RAISE NOTICE '✅ (1) посилання видано: 2 уроки, 750 ₴, каналів авто немає (pending без пошти)';

  -- ── (2) повторно — той самий токен ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res2 := public.issue_payment_link(stu, NULL);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res2->>'token' <> tok THEN RAISE EXCEPTION 'ПРОВАЛ (2): другий виклик дав інший токен'; END IF;
  SELECT count(*) INTO n FROM public.payment_links WHERE tutor_id = tutor AND student_id = stu;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (2): посилань на пару %, а має бути 1', n; END IF;
  RAISE NOTICE '✅ (2) одне посилання на пару';

  -- ── (3) чужий репетитор ─────────────────────────────────────────────────────
  caught := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    res2 := public.issue_payment_link(stu, NULL);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (3): чужий репетитор отримав посилання на чужого учня'; END IF;
  RAISE NOTICE '✅ (3) чужому репетитору відмовлено: %', caught;

  -- ── (4) публічний перегляд (service role) ──────────────────────────────────
  res := public.payment_link_view(tok);
  IF res->>'ok' <> 'true' THEN RAISE EXCEPTION 'ПРОВАЛ (4): перегляд не вдався: %', res; END IF;
  IF res->>'student_first_name' <> 'Оля' OR res->>'tutor_name' <> 'Ірина Репетитор' THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): імена: %', res;
  END IF;
  IF jsonb_array_length(res->'lessons') <> 2 OR (res->>'total')::numeric <> 750 OR res->>'requisites' NOT LIKE 'Монобанк%' THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): уроки/сума/реквізити: %', res;
  END IF;
  IF (res->>'pending_claim')::boolean OR NOT (res->>'can_register')::boolean THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): прапорці заявки/реєстрації: %', res;
  END IF;
  SELECT views INTO v_views FROM public.payment_links WHERE token = tok;
  IF v_views <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (4): перегляди не рахуються (%)', v_views; END IF;
  RAISE NOTICE '✅ (4) сторінка бачить імʼя, 2 боргові уроки, 750 ₴, реквізити; перегляд порахований';

  -- ── (5) «Я оплатив(ла)» з посилання ─────────────────────────────────────────
  res := public.payment_link_claim(tok, 750, 'переказала з картки мами');
  IF res->>'ok' <> 'true' THEN RAISE EXCEPTION 'ПРОВАЛ (5): заявка з посилання не створилась: %', res; END IF;
  claim := (res->>'id')::uuid;
  SELECT count(*) INTO n FROM public.payment_claims WHERE student_id = stu AND tutor_id = tutor AND via = 'link' AND status = 'pending';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (5): заявок pending-учня %, має бути 1', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = tutor AND type LIKE 'payment_claim_%' AND body LIKE '%посилання на оплату%';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (5): репетитор не отримав сповіщення «за посиланням» (%)', n; END IF;
  res2 := public.payment_link_claim(tok, 750, NULL);
  IF res2->>'reason' <> 'already_pending' OR (res2->>'id')::uuid <> claim THEN
    RAISE EXCEPTION 'ПРОВАЛ (5): друга кнопка створила другу заявку: %', res2;
  END IF;
  res := public.payment_link_view(tok);
  IF NOT (res->>'pending_claim')::boolean THEN RAISE EXCEPTION 'ПРОВАЛ (5): сторінка не бачить заявку в очікуванні'; END IF;
  RAISE NOTICE '✅ (5) заявка pending-учня створена, репетитор сповіщений, друга — та сама';

  -- ── (7) репетитор підтверджує — борг закрито канонічним шляхом ─────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.resolve_payment_claim(claim, true);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF res->>'ok' <> 'true' THEN RAISE EXCEPTION 'ПРОВАЛ (7): підтвердження не вдалось: %', res; END IF;
  SELECT count(*) INTO n FROM public.pair_debt_lessons(tutor, stu);
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (7): після підтвердження лишилось боргових уроків: %', n; END IF;
  RAISE NOTICE '✅ (7) підтверджено одним дотиком — борг пари закрито гаманцем';

  -- ── (6) стеля 3 заявки на добу з посилання ─────────────────────────────────
  -- нова заборгованість, щоб заявки мали сенс
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Математика', now() - interval '1 day', 60, 'completed', 'independent', tutor) RETURNING id INTO l_done;
  UPDATE public.lesson_details SET student_price = 500, student_payment_status = 'unpaid' WHERE lesson_id = l_done;
  res := public.payment_link_claim(tok, 100, NULL);   -- 2-га за добу
  UPDATE public.payment_claims SET status = 'rejected', resolved_at = now() WHERE id = (res->>'id')::uuid;
  res := public.payment_link_claim(tok, 100, NULL);   -- 3-тя
  UPDATE public.payment_claims SET status = 'rejected', resolved_at = now() WHERE id = (res->>'id')::uuid;
  res := public.payment_link_claim(tok, 100, NULL);   -- 4-та — стеля
  IF res->>'reason' <> 'too_many' THEN RAISE EXCEPTION 'ПРОВАЛ (6): четверта заявка за добу пройшла: %', res; END IF;
  RAISE NOTICE '✅ (6) стеля 3 заявки на добу з посилання';

  -- ── (9) «переслав сам» — слід у журналі ────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  n := public.payment_link_shared(stu, NULL, 'viber');
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (9): у журнал мав лягти 1 рядок (один борговий урок), а лягло %', n; END IF;
  n := public.payment_link_shared(stu, NULL, 'viber');  -- повтор того ж дня — оновлює час, не падає
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO n FROM public.lesson_payment_reminders WHERE tutor_id = tutor AND student_id = stu AND channel = 'share:viber';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (9): рядків share:viber %, має бути 1', n; END IF;
  RAISE NOTICE '✅ (9) пересилання лишає слід у журналі; повтор не ламає ключ';

  -- ── (8) відкликане посилання ───────────────────────────────────────────────
  UPDATE public.payment_links SET revoked_at = now() WHERE token = tok;
  res := public.payment_link_view(tok);
  IF res->>'reason' <> 'not_found' THEN RAISE EXCEPTION 'ПРОВАЛ (8): відкликане посилання читається'; END IF;
  res := public.payment_link_claim(tok, 100, NULL);
  IF res->>'reason' <> 'not_found' THEN RAISE EXCEPTION 'ПРОВАЛ (8): відкликане посилання приймає заявки'; END IF;
  RAISE NOTICE '✅ (8) відкликане посилання мертве';

  -- ── (10) з браузера функції посилання недоступні ───────────────────────────
  caught := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    res := public.payment_link_view(tok);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (10): payment_link_view доступна з браузера'; END IF;
  caught := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    tok := public.payment_link_for_pair(tutor, stu);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (10): payment_link_for_pair доступна з браузера'; END IF;
  RAISE NOTICE '✅ (10) перегляд/заявка/службовий токен — лише службова роль';
END $$;

ROLLBACK;
