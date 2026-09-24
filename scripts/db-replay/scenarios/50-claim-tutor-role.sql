-- Сценарій: реєстрація через Google робила з репетитора УЧНЯ (аудит шляхів 24.09).
-- OAuth не несе нашої ролі, тож handle_new_user ставить 'student'. Після входу
-- застосунок питає «Ви репетитор чи учень?» і кличе claim_tutor_role().
-- Перевіряємо ОБИДВА боки: (1) свіжий чистий акаунт справді стає репетитором із
-- самостійним воркспейсом і тріалом; (2) акаунт, який уже живе як учень, або
-- старший за добу — роль НЕ міняє; (3) менеджера через неї не отримати.
-- Усе — як PostgREST: від авторизованого користувача, не суперкористувачем.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  fresh uuid := gen_random_uuid();
  withData uuid := gen_random_uuid();
  oldUser uuid := gen_random_uuid();
  someTutor uuid := gen_random_uuid();
  res text;
  n int;
  ws record;
  caught text;
BEGIN
  -- ── (1) свіжий акаунт «як після Google»: роль student, даних немає ────────
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (fresh, 'google-fresh@test.local', '{"first_name":"Ґуґл","last_name":"Репетиторка"}');
  SELECT count(*) INTO n FROM public.user_roles WHERE user_id = fresh AND role = 'student'::app_role;
  IF n <> 1 THEN RAISE EXCEPTION 'очікували автоматичну роль student, маємо %', n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fresh, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.claim_tutor_role();
  IF res <> 'ok' THEN RAISE EXCEPTION 'свіжий акаунт не став репетитором: %', res; END IF;

  SELECT count(*) INTO n FROM public.user_roles WHERE user_id = fresh AND role = 'tutor'::app_role;
  IF n <> 1 THEN RAISE EXCEPTION 'роль tutor не зʼявилась'; END IF;
  SELECT count(*) INTO n FROM public.user_roles WHERE user_id = fresh AND role = 'student'::app_role;
  IF n <> 0 THEN RAISE EXCEPTION 'учнівська роль лишилась — людина в двох застосунках одночасно'; END IF;

  SELECT independent_workspace, subscription_status, trial_until INTO ws
    FROM public.tutor_workspace_settings WHERE tutor_id = fresh;
  IF ws IS NULL OR ws.independent_workspace IS NOT TRUE THEN RAISE EXCEPTION 'самостійний воркспейс не увімкнено'; END IF;
  IF ws.trial_until IS NULL OR ws.trial_until < now() + interval '25 days' THEN
    RAISE EXCEPTION 'тріал не поставлено: %', ws.trial_until;
  END IF;

  -- повторний виклик нічого не ламає
  IF public.claim_tutor_role() <> 'already_tutor' THEN RAISE EXCEPTION 'повторний виклик відповів не already_tutor'; END IF;

  -- ── (2) акаунт, який уже живе як учень, роль не міняє ────────────────────
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', NULL, true);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (someTutor, 'owner-tutor@test.local', '{"first_name":"Інша","last_name":"Репетиторка","role":"tutor","independent_workspace":true}'),
    (withData, 'google-student@test.local', '{"first_name":"Учень","last_name":"Живий"}');
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
  VALUES (someTutor, withData, 'Математика', 400, 'UAH', 'independent');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', withData, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  IF public.claim_tutor_role() <> 'has_data' THEN
    RAISE EXCEPTION 'акаунт з учнівськими даними змінив роль — так можна було б забрати чужі уроки';
  END IF;
  SELECT count(*) INTO n FROM public.user_roles WHERE user_id = withData AND role = 'student'::app_role;
  IF n <> 1 THEN RAISE EXCEPTION 'учнівську роль зіпсовано'; END IF;

  -- ── (3) старший за добу акаунт — теж ні ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', NULL, true);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (oldUser, 'google-old@test.local', '{"first_name":"Старий","last_name":"Акаунт"}');
  UPDATE auth.users SET created_at = now() - interval '3 days' WHERE id = oldUser;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', oldUser, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  IF public.claim_tutor_role() <> 'too_late' THEN RAISE EXCEPTION 'вікно 24 години не працює'; END IF;

  -- ── (4) менеджера через цей шлях не отримати ─────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fresh, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (fresh, 'manager'::app_role);
    RAISE EXCEPTION 'роль менеджера вдалося вписати самому — це дірка';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    GET STACKED DIAGNOSTICS caught = MESSAGE_TEXT;
    IF caught = 'роль менеджера вдалося вписати самому — це дірка' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', NULL, true);
  RAISE NOTICE '✅ Google-реєстрація: свіжий акаунт стає репетитором (воркспейс + тріал) · з даними — ні · старший за добу — ні · менеджера не взяти';
END $$;

ROLLBACK;
