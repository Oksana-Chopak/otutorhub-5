-- Сценарій: red team, жовтень (20.10) — міграція 20261020100000_redteam_october.
-- Кожна знахідка проходу стає перевіркою тут (червона без міграції, зелена з нею):
--   (1) злиття запрошеного профілю — лише після підтвердження пошти; злиття вміє
--       зливатись у акаунт, що ВЖЕ має роль і рядок налаштувань (хабовий репетитор
--       від менеджера лишається у школі, роль запрошеного головна);
--   (2) merge_pending_profile не викликати з браузера;
--   (3) create_notification: сторонній → адміну не більше 10/год; дедуп за type не обхід;
--   (4) заявки на Pro схвалює/відхиляє лише суперадмін;
--   (5) is_pending_email: понад 60 спроб з адреси → false, службовий ключ без стелі;
--   (6) error_log: прямий INSERT з браузера закрито, log_client_error чистить адресу,
--       user_id бере з JWT, стеля на людину;
--   (7) секретні колонки (liqpay_payments.card_token/raw_callback, токени Google)
--       з браузера не читаються, решта колонок — читається (пастка «порожній екран»).
-- ROLLBACK у кінці — база чиста.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  hubid   uuid := gen_random_uuid();
  mgr     uuid := gen_random_uuid();
  admin_u uuid := gen_random_uuid();
  tutor   uuid := gen_random_uuid();
  indep   uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  ghost_t uuid := gen_random_uuid();   -- запрошений менеджером репетитор
  ghost_s uuid := gen_random_uuid();   -- запрошений репетитором учень
  real_t  uuid := gen_random_uuid();
  real_s  uuid := gen_random_uuid();
  req_id  uuid;
  n integer;
  i integer;
  c text;
  _ok boolean;
  _role text;
BEGIN
  -- ── сетап: школа, менеджер, платформний адмін, незалежний, сторонній ─────────
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (mgr,      'mgr68@test.local',      now(), '{"first_name":"Мен","last_name":"Еджер","role":"tutor"}'),
    (admin_u,  'admin68@test.local',    now(), '{"first_name":"Адмін","last_name":"Платформи","role":"tutor"}'),
    (tutor,    'tutor68@test.local',    now(), '{"first_name":"Репетитор","last_name":"Школи","role":"tutor"}'),
    (indep,    'indep68@test.local',    now(), '{"first_name":"Незалежний","last_name":"Репетитор","role":"tutor","independent_workspace":true}'),
    (stranger, 'stranger68@test.local', now(), '{"first_name":"Сторонній","last_name":"Учень","role":"student"}');
  INSERT INTO public.hubs (id, name, created_by) VALUES (hubid, 'Школа 68', mgr);
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hubid, mgr);
  DELETE FROM public.user_roles WHERE user_id = mgr AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (mgr, 'manager') ON CONFLICT DO NOTHING;
  INSERT INTO public.platform_admins (user_id) VALUES (admin_u) ON CONFLICT DO NOTHING;
  UPDATE public.tutor_workspace_settings SET hub_id = hubid, independent_workspace = false WHERE tutor_id = tutor;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hubid, tutor) ON CONFLICT DO NOTHING;
  UPDATE public.tutor_workspace_settings
     SET independent_workspace = true, subscription_status = 'trial', trial_until = now() + interval '30 days'
   WHERE tutor_id = indep;

  -- ── (1) злиття: запрошений менеджером репетитор зі школою ───────────────────
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (ghost_t, 'Ірина', 'Запрошена', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (ghost_t, 'tutor'::app_role) ON CONFLICT (user_id) DO UPDATE SET role = 'tutor'::app_role;
  INSERT INTO public.profile_contacts (user_id, email) VALUES (ghost_t, 'iryna68@test.local') ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status, hub_id)
    VALUES (ghost_t, false, 'free', hubid) ON CONFLICT (tutor_id) DO UPDATE SET hub_id = EXCLUDED.hub_id, independent_workspace = false;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hubid, ghost_t) ON CONFLICT DO NOTHING;

  -- людина реєструється як «репетитор» (форма дає тріал і independent=true), пошта ще не підтверджена
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (real_t, 'iryna68@test.local', '{"first_name":"Ірина","last_name":"Справжня","role":"tutor","independent_workspace":true}');
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = ghost_t AND is_pending = true) THEN
    RAISE EXCEPTION '(1) ДІРКА: запрошений репетитор злився до підтвердження пошти';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE tutor_id = real_t AND hub_id IS NULL) THEN
    RAISE EXCEPTION '(1) сетап: bootstrap реєстрації не створив рядок налаштувань';
  END IF;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = real_t;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = ghost_t) THEN
    RAISE EXCEPTION '(1) запрошений репетитор не злився після підтвердження';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE tutor_id = real_t AND hub_id = hubid AND independent_workspace = false) THEN
    RAISE EXCEPTION '(1) ДІРКА: після злиття репетитор школи втратив школу (hub_id) — рядок реєстрації переміг рядок менеджера';
  END IF;
  SELECT count(*) INTO n FROM public.tutor_workspace_settings WHERE tutor_id IN (real_t, ghost_t);
  IF n <> 1 THEN RAISE EXCEPTION '(1) рядків налаштувань після злиття: % (має бути 1)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = real_t AND role = 'tutor'::app_role) THEN
    RAISE EXCEPTION '(1) роль репетитора не перейшла';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hub_members WHERE user_id = real_t AND hub_id = hubid) THEN
    RAISE EXCEPTION '(1) членство у школі не перейшло';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = real_t AND email = 'iryna68@test.local') THEN
    RAISE EXCEPTION '(1) контакти після злиття не заповнено';
  END IF;
  RAISE NOTICE '✅ (1a) репетитор школи: до підтвердження нічого, після — школа, роль, членство й контакти';

  -- запрошений учень реєструється з іншою роллю у формі → роль запрошеного головна (як і раніше)
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (ghost_s, 'Олесь', 'Учень', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (ghost_s, 'student'::app_role) ON CONFLICT (user_id) DO UPDATE SET role = 'student'::app_role;
  INSERT INTO public.profile_contacts (user_id, email) VALUES (ghost_s, 'oles68@test.local') ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (indep, ghost_s, 'Математика', 400, 'UAH', 'independent');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (indep, ghost_s, 'Математика', now() + interval '1 day', 60, 'scheduled', 'independent', indep);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (real_s, 'oles68@test.local', '{"first_name":"Олесь","last_name":"Справжній","role":"tutor","independent_workspace":true}');
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = real_s;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = ghost_s) THEN
    RAISE EXCEPTION '(1b) запрошений учень не злився після підтвердження';
  END IF;
  SELECT string_agg(role::text, ',') INTO c FROM public.user_roles WHERE user_id = real_s;
  IF c IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION '(1b) роль після злиття: % (має бути student — роль запрошеного головна, UNIQUE(user_id) не впав)', c;
  END IF;
  SELECT count(*) INTO n FROM public.lessons WHERE student_id = real_s;
  IF n <> 1 THEN RAISE EXCEPTION '(1b) урок не перейшов на реальний акаунт (%)', n; END IF;
  RAISE NOTICE '✅ (1b) запрошений учень, що обрав у формі «репетитор»: роль запрошеного головна, урок перейшов, UNIQUE(user_id) цілий';

  -- ── (2) злиття не викликати з браузера ──────────────────────────────────────
  IF has_function_privilege('authenticated', 'public.merge_pending_profile(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.merge_pending_profile(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '(2) ДІРКА: merge_pending_profile можна викликати з браузера — чужий запрошений профіль зливається у свій акаунт за поштою';
  END IF;
  RAISE NOTICE '✅ (2) merge_pending_profile — лише тригери auth.users';

  -- ── (3) дзвіночок: сторонній → адміну зі стелею ─────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  n := 0;
  FOR i IN 1..12 LOOP
    BEGIN
      PERFORM public.create_notification(admin_u, 'spam_' || i, 'Оплату підтверджено', 'тест', '/subscription');
      n := n + 1;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF n > 10 THEN
    RAISE EXCEPTION '(3) ДІРКА: сторонній надіслав адміну % сповіщень з різними type — стелі немає', n;
  END IF;
  IF n < 1 THEN
    RAISE EXCEPTION '(3) notify_managers для людей без школи має й далі доходити до адміна (пройшло %)', n;
  END IF;
  -- стороннього до чужого НЕадміна й далі не пускаємо
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.create_notification(indep, 'x', 'x', 'x', '/');
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION '(3) ДІРКА: сторонній надіслав сповіщення незнайомому репетитору';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
  END;
  RAISE NOTICE '✅ (3) сторонній → адміну: % пройшло з 12 (стеля 10/год), незнайомцю — нічого', n;

  -- ── (4) заявки на Pro — лише суперадмін ─────────────────────────────────────
  INSERT INTO public.subscription_requests (tutor_id, plan, price, status) VALUES (indep, 'monthly', 249, 'new') RETURNING id INTO req_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.approve_subscription_request(req_id, 12, NULL);
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION '(4) ДІРКА: менеджер школи схвалив заявку незалежного на 12 місяців Pro';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    PERFORM public.reject_subscription_request(req_id, 'ні');
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION '(4) ДІРКА: менеджер школи відхилив заявку незалежного';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
  END;
  IF (SELECT status::text FROM public.subscription_requests WHERE id = req_id) <> 'new' THEN
    RAISE EXCEPTION '(4) статус заявки змінився без права';
  END IF;
  RAISE NOTICE '✅ (4) approve/reject_subscription_request: менеджер без суперадмінства отримує insufficient_privilege';

  -- ── (5) is_pending_email зі стелею ──────────────────────────────────────────
  PERFORM set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
  PERFORM set_config('role', 'anon', true);
  n := 0;
  FOR i IN 1..61 LOOP
    IF public.is_pending_email('nobody-' || i || '@test.local') THEN n := n + 1; END IF;
  END LOOP;
  -- 61 спроб з однієї адреси: наступна про справжню запрошену пошту має дати false
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (gen_random_uuid(), 'Проба', 'Запрошена', true) RETURNING id INTO req_id;
  INSERT INTO public.profile_contacts (user_id, email) VALUES (req_id, 'probe68@test.local') ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  PERFORM set_config('role', 'anon', true);
  _ok := public.is_pending_email('probe68@test.local');
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.headers', '', true);
  IF _ok THEN
    RAISE EXCEPTION '(5) ДІРКА: після 61 проби з однієї адреси is_pending_email і далі відповідає чесно — перебір пошт без стелі';
  END IF;
  -- інша адреса — відповідає чесно
  PERFORM set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', true);
  PERFORM set_config('role', 'anon', true);
  _ok := public.is_pending_email('probe68@test.local');
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.headers', '', true);
  IF NOT _ok THEN RAISE EXCEPTION '(5) інша адреса успадкувала чужу стелю'; END IF;
  -- службовий ключ (edge confirm-pending-signup) — без стелі
  PERFORM set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  _ok := public.is_pending_email('probe68@test.local');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  IF NOT _ok THEN RAISE EXCEPTION '(5) службовий ключ потрапив під стелю — fast path запрошених зламається'; END IF;
  RAISE NOTICE '✅ (5) is_pending_email: 60/год з адреси, понад — false; інша адреса й service_role — чесно';

  -- ── (6) error_log лише через RPC ────────────────────────────────────────────
  IF has_table_privilege('anon', 'public.error_log', 'INSERT') OR has_table_privilege('authenticated', 'public.error_log', 'INSERT') THEN
    RAISE EXCEPTION '(6) ДІРКА: прямий INSERT у error_log з браузера відкритий';
  END IF;
  IF NOT has_function_privilege('anon', 'public.log_client_error(text, text, text, text, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '(6) анонім (лендінг) не може записати помилку через RPC';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.log_client_error('TypeError: boom', 'at x', '/pay/SECRET-TOKEN-123?invite=abc&email=x%40y.z#frag', 'UA', '{"where":"test"}'::jsonb);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT url INTO c FROM public.error_log WHERE message = 'TypeError: boom' ORDER BY created_at DESC LIMIT 1;
  IF c IS DISTINCT FROM '/pay/…' THEN
    RAISE EXCEPTION '(6) адреса в журналі не вичищена: %', c;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.error_log WHERE message = 'TypeError: boom' AND user_id = stranger AND role = 'student') THEN
    RAISE EXCEPTION '(6) user_id/role не взято з JWT';
  END IF;
  -- стеля на людину: 60/год, далі мовчки
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOR i IN 1..70 LOOP
    PERFORM public.log_client_error('flood ' || i, NULL, '/x', NULL, NULL);
  END LOOP;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM public.error_log WHERE user_id = stranger;
  IF n > 60 THEN RAISE EXCEPTION '(6) ДІРКА: одна людина записала % рядків — стелі немає', n; END IF;
  RAISE NOTICE '✅ (6) error_log: прямий INSERT закрито, RPC чистить адресу (% ), user_id з JWT, стеля 60/год (записано %)', c, n;

  -- ── (7) секретні колонки з браузера не читаються, решта — читається ─────────
  INSERT INTO public.liqpay_payments (tutor_id, order_id, plan, amount, status, card_token, raw_callback)
    VALUES (indep, 'order-68', 'monthly', 249, 'success', 'tok_secret', '{"card_token":"tok_secret"}'::jsonb);
  INSERT INTO public.google_calendar_tokens (user_id, access_token, refresh_token, google_email)
    VALUES (indep, 'ya29.secret', '1//refresh-secret', 'indep@gmail.test');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indep, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM card_token FROM public.liqpay_payments WHERE tutor_id = indep;
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(7) ДІРКА: репетитор читає card_token LiqPay з браузера';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM raw_callback FROM public.liqpay_payments WHERE tutor_id = indep;
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(7) ДІРКА: репетитор читає сирий колбек LiqPay з браузера';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM refresh_token FROM public.google_calendar_tokens WHERE user_id = indep;
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(7) ДІРКА: refresh_token Google читається з браузера';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM access_token FROM public.google_calendar_tokens WHERE user_id = indep;
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(7) ДІРКА: access_token Google читається з браузера';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- те, що клієнт справді читає — має читатись (GoogleCalendarCard: google_email; onboarding: user_id)
  SELECT count(*) INTO n FROM public.google_calendar_tokens WHERE user_id = indep AND google_email = 'indep@gmail.test';
  IF n <> 1 THEN RAISE EXCEPTION '(7) власник не бачить google_email свого підключення'; END IF;
  SELECT count(*) INTO n FROM public.liqpay_payments WHERE tutor_id = indep AND status = 'success' AND amount = 249;
  IF n <> 1 THEN RAISE EXCEPTION '(7) репетитор не бачить власний платіж без секретних колонок'; END IF;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  -- пастка «порожній екран»: КОЖНА несекретна колонка цих таблиць має SELECT для authenticated
  -- (нова колонка від Lovable без GRANT ламала б select у клієнті — цей рядок про це скаже).
  FOR c IN
    SELECT table_name || '.' || column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'liqpay_payments' AND column_name NOT IN ('card_token', 'raw_callback'))
         OR (table_name = 'google_calendar_tokens' AND column_name NOT IN ('access_token', 'refresh_token')))
       AND NOT has_column_privilege('authenticated', 'public.' || table_name, column_name, 'SELECT')
  LOOP
    RAISE EXCEPTION '(7) колонка % без SELECT для authenticated — додай її до GRANT у міграції, інакше клієнтський select упаде', c;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE liqpay_card_token IS NOT NULL) THEN
    RAISE EXCEPTION '(7) liqpay_card_token у налаштуваннях не очищено';
  END IF;
  RAISE NOTICE '✅ (7) card_token/raw_callback/токени Google з браузера не читаються; решта колонок — читається';
END $$;

ROLLBACK;
