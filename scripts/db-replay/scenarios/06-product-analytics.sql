-- Сценарій: аналітика продукту (02.10) — воронка, прапорці, групи помилок.
-- (1) когорта: двоє репетиторів цього тижня — один дійшов до AHA (позначив
--     оплату), другий лише зареєструвався; місячної давнини третій — відвалився;
-- (2) прапорці: вимкнений — false для всіх; увімкнений на 0 % з поіменним
--     дозволом — true лише дозволеному; анонім бачить лише 100 %;
-- (3) групи помилок: один і той самий текст з різними id — одна група, «нова»;
--     стара помилка, що повторилась, — не нова; анонім може записати помилку;
-- (4) воронку й групи помилок бачить лише суперадмін.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  admin uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  t3 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  l1 uuid;
  f jsonb; g jsonb; c jsonb;
BEGIN
  -- суперадмін і три репетитори
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (admin, 'admin06@test.local', '{"first_name":"Супер","last_name":"Адмін","role":"tutor","independent_workspace":true}'),
    (t1, 't1-06@test.local', '{"first_name":"Аха","last_name":"Репетитор","role":"tutor","independent_workspace":true}'),
    (t2, 't2-06@test.local', '{"first_name":"Лише","last_name":"Зареєстрований","role":"tutor","independent_workspace":true}'),
    (t3, 't3-06@test.local', '{"first_name":"Давно","last_name":"Відвалився","role":"tutor","independent_workspace":true}'),
    (s1, 's1-06@test.local', '{"first_name":"Учень","last_name":"Перший"}');
  INSERT INTO public.platform_admins (user_id) VALUES (admin) ON CONFLICT DO NOTHING;
  UPDATE auth.users SET created_at = now() - interval '40 days' WHERE id = t3;
  UPDATE public.tutor_workspace_settings SET independent_workspace = true, subscription_status = 'trial', trial_until = now() + interval '30 days' WHERE tutor_id IN (t1, t2, t3);

  -- t1: учень, урок, оплата позначена → AHA
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (t1, s1, 'Хімія', 400, 'UAH', 'independent');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (t1, s1, 'Хімія', now() - interval '1 day', 60, 'completed', 'independent', t1) RETURNING id INTO l1;
  UPDATE public.lesson_details SET student_payment_status = 'paid', student_paid_at = now() WHERE lesson_id = l1;
  INSERT INTO public.app_events (user_id, name, props) VALUES (t1, 'app_open', '{}'), (t1, 'page_view', '{"path":"/"}');
  -- t3: активність лише 30 днів тому
  INSERT INTO public.app_events (user_id, name, props, created_at) VALUES (t3, 'app_open', '{}', now() - interval '30 days');

  -- ── (1) воронка ───────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  f := public.admin_product_funnel(8);
  PERFORM set_config('role', 'postgres', true);
  SELECT x INTO c FROM jsonb_array_elements(f->'cohorts') x WHERE (x->>'week')::date = date_trunc('week', now())::date;
  IF c IS NULL THEN RAISE EXCEPTION '(1) когорти цього тижня немає: %', f; END IF;
  IF (c->>'signed')::int < 3 OR (c->>'added_student')::int < 1 OR (c->>'created_lesson')::int < 1 OR (c->>'aha')::int < 1 THEN
    RAISE EXCEPTION '(1) когорта рахується неправильно: %', c;
  END IF;
  IF (c->>'aha')::int >= (c->>'signed')::int THEN RAISE EXCEPTION '(1) усі дійшли до AHA — t2 мав лишитись без нього: %', c; END IF;
  SELECT x INTO c FROM jsonb_array_elements(f->'cohorts') x WHERE (x->>'week')::date = date_trunc('week', now() - interval '40 days')::date;
  IF c IS NULL OR (c->>'churned')::int <> 1 THEN RAISE EXCEPTION '(1) відвалений місячної давнини не порахований: %', c; END IF;
  IF jsonb_array_length(f->'daily') <> 14 THEN RAISE EXCEPTION '(1) добова активність має 14 днів: %', jsonb_array_length(f->'daily'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'active') a WHERE a->>'role' = 'tutor' AND (a->>'dau')::int >= 1) THEN
    RAISE EXCEPTION '(1) DAU репетиторів має бути ≥1: %', f->'active';
  END IF;
  RAISE NOTICE '✅ (1) воронка: зареєструвались → учень → урок → AHA, відвалений порахований, DAU/WAU/MAU і 14 днів';

  -- ── (2) прапорці ──────────────────────────────────────────────────────────
  INSERT INTO public.feature_flags (key, enabled, rollout_pct, allow_users) VALUES
    ('scen06_off', false, 100, '{}'),
    ('scen06_allow', true, 0, ARRAY[t1])
  ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, rollout_pct = EXCLUDED.rollout_pct, allow_users = EXCLUDED.allow_users;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  g := public.my_feature_flags();
  PERFORM set_config('role', 'postgres', true);
  IF (g->>'scen06_off')::boolean IS NOT FALSE OR (g->>'scen06_allow')::boolean IS NOT TRUE OR (g->>'import_sheet_link')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '(2) прапорці для дозволеного: %', g;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', t2, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  g := public.my_feature_flags();
  PERFORM set_config('role', 'postgres', true);
  IF (g->>'scen06_allow')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(2) 0 %% без дозволу мав бути false: %', g; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('role', 'anon', true);
  g := public.my_feature_flags();
  BEGIN
    UPDATE public.feature_flags SET enabled = true WHERE key = 'scen06_off';
    PERFORM set_config('role', 'postgres', true);
    IF EXISTS (SELECT 1 FROM public.feature_flags WHERE key = 'scen06_off' AND enabled) THEN
      RAISE EXCEPTION '(2) анонім змінив прапорець';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role', 'postgres', true);
  END;
  IF (g->>'scen06_allow')::boolean IS NOT FALSE OR (g->>'landing_sheet_link')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '(2) анонім бачить лише 100 %%: %', g;
  END IF;
  RAISE NOTICE '✅ (2) прапорці: вимкнений — усім false; 0 %% + поіменно — лише дозволеному; анонім — лише 100 %% і не пише';

  -- ── (3) групи помилок ─────────────────────────────────────────────────────
  PERFORM set_config('role', 'anon', true);
  INSERT INTO public.error_log (message, url) VALUES ('Cannot read lesson 11111111-1111-4111-8111-111111111111 (code 500)', '/auth');
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.error_log (user_id, message, url) VALUES
    (t1, 'Cannot read lesson 22222222-2222-4222-8222-222222222222 (code 503)', '/schedule'),
    (t2, 'Old failure that happened before', '/finances');
  INSERT INTO public.error_log (user_id, message, url, created_at) VALUES (t3, 'Old failure that happened before', '/finances', now() - interval '3 days');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  g := public.error_groups(24, 20);
  PERFORM set_config('role', 'postgres', true);
  SELECT x INTO c FROM jsonb_array_elements(g) x WHERE x->>'signature' LIKE 'Cannot read lesson #%';
  IF c IS NULL OR (c->>'hits')::int <> 2 OR (c->>'is_new')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '(3) два записи з різними id мали стати однією НОВОЮ групою: %', g;
  END IF;
  SELECT x INTO c FROM jsonb_array_elements(g) x WHERE x->>'signature' = 'Old failure that happened before';
  IF c IS NULL OR (c->>'is_new')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(3) стара помилка не мала бути «новою»: %', g; END IF;
  RAISE NOTICE '✅ (3) помилки: однакові тексти з різними id — одна група; нова/стара розрізняються; анонім може записати';

  -- ── (4) лише суперадмін ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    f := public.admin_product_funnel(4);
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(4) ДІРКА: звичайний репетитор прочитав воронку платформи';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role', 'postgres', true);
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  g := public.error_groups(24, 20);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF jsonb_array_length(g) <> 0 THEN RAISE EXCEPTION '(4) ДІРКА: звичайний репетитор бачить чужі помилки: %', g; END IF;
  RAISE NOTICE '✅ (4) воронка й групи помилок — лише суперадмін';
END $$;

ROLLBACK;
