-- Сценарій: публічні двері (27.09) — ліміт у базі, пошук акаунта за поштою,
-- і головне: реєстрація з ЧУЖИМ телефоном більше не забирає чужий профіль.
-- (1) rate_limit_check: три спроби при стелі 3 проходять, четверта — «забагато»;
--     інший ключ — свій лічильник; людина з браузера (authenticated) викликати не може.
-- (2) user_id_by_email знаходить акаунт незалежно від регістру, незнайому — NULL.
-- (3) Запрошений учень має пошту й телефон. Стороння людина реєструється зі
--     СВОЄЮ поштою і ЙОГО телефоном → нічого не переноситься, запрошення живе.
-- (4) Сам учень реєструється зі своєю поштою → уроки й ставку перенесено, як і було.
-- (5) Запрошений лише з телефоном (пошти репетитор не знав) → реєстрація з цим
--     телефоном переносить профіль — цей шлях лишається.
-- (6) У живої людини такий самий телефон, як у новачка → її рядок контактів цілий
--     (раніше злиття видаляло контакти будь-кого зі спільним номером).
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  tutor    uuid := gen_random_uuid();
  ghostA   uuid := gen_random_uuid();   -- запрошений з поштою і телефоном
  ghostB   uuid := gen_random_uuid();   -- запрошений лише з телефоном
  attacker uuid := gen_random_uuid();
  victim   uuid := gen_random_uuid();
  phoneOnly uuid := gen_random_uuid();
  livePerson uuid := gen_random_uuid();
  newcomer uuid := gen_random_uuid();
  found uuid;
  n integer;
  i integer;
  limited boolean;
BEGIN
  -- ── (1) ліміт у базі ──────────────────────────────────────────────────────
  FOR i IN 1..3 LOOP
    IF public.rate_limit_check('scen96', '1.2.3.4', 3, 60) THEN
      RAISE EXCEPTION '(1) спроба % при стелі 3 вже відмовлена', i;
    END IF;
  END LOOP;
  IF NOT public.rate_limit_check('scen96', '1.2.3.4', 3, 60) THEN
    RAISE EXCEPTION '(1) четверта спроба при стелі 3 пройшла — ліміт не працює';
  END IF;
  IF public.rate_limit_check('scen96', '5.6.7.8', 3, 60) THEN
    RAISE EXCEPTION '(1) інша адреса успадкувала чужий ліміт';
  END IF;
  IF public.rate_limit_check('scen96-email', 'x@y.z', 1, 60) THEN
    RAISE EXCEPTION '(1) перша спроба по пошті відмовлена';
  END IF;
  IF NOT public.rate_limit_check('scen96-email', 'X@Y.Z', 1, 60) THEN
    RAISE EXCEPTION '(1) регістр пошти обходить ліміт';
  END IF;
  IF has_function_privilege('authenticated', 'public.rate_limit_check(text, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rate_limit_check(text, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '(1) ліміт можна викликати з браузера — лічильник можна набити чужим ключем';
  END IF;
  SELECT count(*) INTO n FROM public.rate_limit_hits WHERE key_hash LIKE '%1.2.3.4%';
  IF n <> 0 THEN RAISE EXCEPTION '(1) адреса збережена в чистому вигляді'; END IF;
  RAISE NOTICE '✅ (1) ліміт у базі: 3 проходять, 4-та «забагато», ключі окремі, з браузера не викликати, адреса лише хешем';

  -- ── (2) пошук акаунта за поштою ───────────────────────────────────────────
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (tutor, 'Tutor96@Test.local', '{"first_name":"Оксана","last_name":"Р","role":"tutor","independent_workspace":true}');
  UPDATE public.tutor_workspace_settings
     SET independent_workspace = true, subscription_status = 'trial', trial_until = now() + interval '30 days'
   WHERE tutor_id = tutor;
  found := public.user_id_by_email('tutor96@test.local');
  IF found IS DISTINCT FROM tutor THEN RAISE EXCEPTION '(2) акаунт за поштою не знайдено (регістр)'; END IF;
  IF public.user_id_by_email('nobody96@test.local') IS NOT NULL THEN RAISE EXCEPTION '(2) незнайома пошта дала акаунт'; END IF;
  IF has_function_privilege('authenticated', 'public.user_id_by_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '(2) пошук акаунтів за поштою доступний з браузера — перебір адрес';
  END IF;
  RAISE NOTICE '✅ (2) user_id_by_email: знаходить незалежно від регістру, незнайому — NULL, лише service_role';

  -- ── сетап запрошених (без JWT: гард ролей — no-op лише при auth.uid() IS NULL)
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES
    (ghostA, 'Марія', 'Запрошена', true),
    (ghostB, 'Тарас', 'Телефонний', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (ghostA, 'student'::app_role), (ghostB, 'student'::app_role)
    ON CONFLICT (user_id) DO UPDATE SET role = 'student'::app_role;
  INSERT INTO public.profile_contacts (user_id, email, phone) VALUES
    (ghostA, 'maria96@test.local', '+380501112233'),
    (ghostB, NULL, '+380509998877')
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone;
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source) VALUES
    (tutor, ghostA, 'Англійська', 500, 'UAH', 'independent'),
    (tutor, ghostB, 'Фізика', 350, 'UAH', 'independent');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, ghostA, 'Англійська', now() + interval '2 days', 60, 'scheduled', 'independent', tutor);

  -- ── (3) стороння людина зі своєю поштою і ЧУЖИМ телефоном ─────────────────
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (attacker, 'attacker96@test.local', '{"first_name":"Хтось","last_name":"Чужий","phone":"+380501112233"}');
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = ghostA AND is_pending = true) THEN
    RAISE EXCEPTION '(3) ДІРКА: запрошений профіль зник — реєстрація з чужим телефоном забрала його';
  END IF;
  SELECT count(*) INTO n FROM public.student_rates WHERE student_id = attacker;
  IF n <> 0 THEN RAISE EXCEPTION '(3) ДІРКА: чужа ставка перейшла на сторонній акаунт'; END IF;
  SELECT count(*) INTO n FROM public.lessons WHERE student_id = attacker;
  IF n <> 0 THEN RAISE EXCEPTION '(3) ДІРКА: чужий урок перейшов на сторонній акаунт'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = ghostA AND email = 'maria96@test.local') THEN
    RAISE EXCEPTION '(3) контакти запрошеного стерто чужою реєстрацією';
  END IF;
  RAISE NOTICE '✅ (3) чужа реєстрація з телефоном запрошеного нічого не забрала — запрошення живе';

  -- ── (4) сам учень приходить зі своєї пошти → перенесено ──────────────────
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (victim, 'maria96@test.local', '{"first_name":"Марія","last_name":"Справжня"}');
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = ghostA) THEN
    RAISE EXCEPTION '(4) запрошений профіль не злився з реальним акаунтом';
  END IF;
  SELECT count(*) INTO n FROM public.student_rates WHERE student_id = victim AND tutor_id = tutor;
  IF n <> 1 THEN RAISE EXCEPTION '(4) ставка не перейшла на реальний акаунт (%)', n; END IF;
  SELECT count(*) INTO n FROM public.lessons WHERE student_id = victim;
  IF n <> 1 THEN RAISE EXCEPTION '(4) урок не перейшов на реальний акаунт (%)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = victim AND email = 'maria96@test.local' AND phone = '+380501112233') THEN
    RAISE EXCEPTION '(4) контакти реального акаунта не заповнено з запрошення';
  END IF;
  IF public.is_pending_email('maria96@test.local') THEN
    RAISE EXCEPTION '(4) пошта й далі «запрошена» — репетитор бачив би учня як не зареєстрованого';
  END IF;
  RAISE NOTICE '✅ (4) свій акаунт зі своєї пошти отримав уроки, ставку й контакти запрошення (раніше злиття з уроками падало: student_id is immutable)';

  -- ── (5) запрошений лише з телефоном → реєстрація з телефоном переносить ──
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (phoneOnly, 'taras96@test.local', '{"first_name":"Тарас","last_name":"Справжній","phone":"+380509998877"}');
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = ghostB) THEN
    RAISE EXCEPTION '(5) запрошений ЛИШЕ з телефоном не злився — шлях без пошти зламано';
  END IF;
  SELECT count(*) INTO n FROM public.student_rates WHERE student_id = phoneOnly AND tutor_id = tutor;
  IF n <> 1 THEN RAISE EXCEPTION '(5) ставка запрошеного з телефоном не перейшла (%)', n; END IF;
  RAISE NOTICE '✅ (5) запрошений без пошти й далі приходить за телефоном';

  -- ── (6) спільний телефон у живої людини → її контакти цілі ───────────────
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (livePerson, 'mother96@test.local', '{"first_name":"Мама","last_name":"Двох","phone":"+380671234567"}');
  IF NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = livePerson AND phone = '+380671234567') THEN
    RAISE EXCEPTION '(6) сетап: контакт живої людини не записано';
  END IF;
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (newcomer, 'child96@test.local', '{"first_name":"Дитина","last_name":"Друга","phone":"+380671234567"}');
  IF NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = livePerson AND phone = '+380671234567' AND email = 'mother96@test.local') THEN
    RAISE EXCEPTION '(6) ДІРКА: реєстрація зі спільним телефоном стерла контакти живої людини';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = newcomer AND phone = '+380671234567') THEN
    RAISE EXCEPTION '(6) новачок зі спільним телефоном лишився без контакту';
  END IF;
  RAISE NOTICE '✅ (6) спільний телефон: контакти обох цілі';

  -- ── (7) незмінність уроку для людини з браузера не послабилась ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    UPDATE public.lessons SET student_id = attacker WHERE student_id = victim;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION '(7) ДІРКА: репетитор з браузера переписав учня на уроці';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
    RAISE NOTICE '✅ (7) з браузера student_id уроку й далі незмінний';
  END;
END $$;

ROLLBACK;
