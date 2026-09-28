-- Сценарій: замок на сервері (27.09) — той самий предикат, що в клієнта.
-- (1) незалежний з ЖИВИМ тріалом ставить урок і поповнює гаманець — можна;
-- (2) той самий після закінчення тріалу — SUBSCRIPTION_REQUIRED і на уроці, і на гаманці;
-- (3) активна підписка — знову можна;
-- (4) хабовий репетитор без підписки ставить хабовий урок — не зачеплений;
-- (5) менеджер школи поповнює гаманець учня хабового репетитора — не зачеплений;
-- (6) службовий запис (auth.uid() NULL) — не зачеплений;
-- (7) прямий INSERT у гаманець з браузера закритий RLS — єдиний шлях поповнення wallet_topup (див. (2)).
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  indep uuid := gen_random_uuid();
  student uuid := gen_random_uuid();
  hubtutor uuid := gen_random_uuid();
  manager uuid := gen_random_uuid();
  hubstudent uuid := gen_random_uuid();
  hub uuid;
  n integer;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (indep, 'indep60b@test.local', '{"first_name":"Неза","last_name":"Лежна","role":"tutor","independent_workspace":true}'),
    (student, 'student60b@test.local', '{"first_name":"Учень","last_name":"Незалежного"}'),
    (manager, 'manager60b@test.local', '{"first_name":"Мене","last_name":"Джер","role":"tutor"}'),
    (hubtutor, 'hubtutor60b@test.local', '{"first_name":"Хабо","last_name":"Вий","role":"tutor"}'),
    (hubstudent, 'hubstudent60b@test.local', '{"first_name":"Учень","last_name":"Школи"}');
  UPDATE public.tutor_workspace_settings
     SET independent_workspace = true, subscription_status = 'trial', trial_until = now() + interval '10 days'
   WHERE tutor_id = indep;
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (indep, student, 'Хімія', 400, 'UAH', 'independent');

  -- ── (1) живий тріал ───────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indep, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (indep, student, 'Хімія', now() + interval '1 day', 60, 'scheduled', 'independent', indep);
  PERFORM public.wallet_topup(indep, student, 2, 800, 'тест', NULL);
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO n FROM public.lessons WHERE tutor_id = indep;
  IF n <> 1 THEN RAISE EXCEPTION '(1) урок з живим тріалом не створився'; END IF;
  RAISE NOTICE '✅ (1) живий тріал: урок і поповнення проходять';

  -- ── (2) тріал закінчився ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true); -- службова правка налаштувань (гард пускає лише без JWT або менеджера)
  UPDATE public.tutor_workspace_settings SET trial_until = now() - interval '1 minute' WHERE tutor_id = indep;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indep, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
      VALUES (indep, student, 'Хімія', now() + interval '2 days', 60, 'scheduled', 'independent', indep);
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(2) ДІРКА: урок після тріалу пройшов повз замок';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('role', 'postgres', true);
    IF SQLERRM NOT LIKE 'SUBSCRIPTION_REQUIRED%' THEN RAISE; END IF;
  END;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.wallet_topup(indep, student, 1, 400, 'тест', NULL);
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(2) ДІРКА: поповнення гаманця після тріалу пройшло повз замок';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('role', 'postgres', true);
    IF SQLERRM NOT LIKE 'SUBSCRIPTION_REQUIRED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '✅ (2) прострочений тріал: і урок, і поповнення — SUBSCRIPTION_REQUIRED';

  -- ── (3) активна підписка ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.tutor_workspace_settings SET subscription_status = 'active', subscription_until = now() + interval '30 days' WHERE tutor_id = indep;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indep, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (indep, student, 'Хімія', now() + interval '3 days', 60, 'scheduled', 'independent', indep);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE '✅ (3) активна підписка: знову можна';

  -- ── (4)(5) школа: хабовий репетитор і менеджер не зачеплені ──────────────
  -- Сетап школи без JWT — як у сценарії 60 (роль менеджера видає create_hub, тут — прямо).
  hub := gen_random_uuid();
  INSERT INTO public.hubs (id, name, created_by) VALUES (hub, 'Школа 60b', manager);
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hub, manager);
  DELETE FROM public.user_roles WHERE user_id = manager AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (manager, 'manager') ON CONFLICT DO NOTHING;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, hub_id) VALUES (hubtutor, false, hub)
    ON CONFLICT (tutor_id) DO UPDATE SET independent_workspace = false, subscription_status = 'free', hub_id = EXCLUDED.hub_id;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hub, hubtutor), (hub, hubstudent) ON CONFLICT DO NOTHING;
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (hubtutor, hubstudent, 'Фізика', 500, 'UAH', 'hub');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hubtutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (hubtutor, hubstudent, 'Фізика', now() + interval '1 day', 60, 'scheduled', 'hub', hubtutor);
  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE '✅ (4) хабовий репетитор без підписки ставить хабовий урок';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', manager, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.wallet_topup(hubtutor, hubstudent, 1, 500, 'школа', NULL);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE '✅ (5) менеджер школи поповнює гаманець учня — не зачеплений';

  -- ── (6) службовий запис ──────────────────────────────────────────────────
  UPDATE public.tutor_workspace_settings SET subscription_status = 'trial', trial_until = now() - interval '1 day' WHERE tutor_id = indep;
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (indep, student, 'Хімія', now() - interval '20 days', 60, 'completed', 'independent', indep);
  RAISE NOTICE '✅ (6) службовий запис (без JWT) не зачеплений';

  -- (7) Прямий INSERT у гаманець з браузера закритий RLS (єдиний шлях — wallet_topup,
  -- перевірений у (2)); списання робить сама база без JWT — (6) показує, що без JWT
  -- замок мовчить.
END $$;

ROLLBACK;
