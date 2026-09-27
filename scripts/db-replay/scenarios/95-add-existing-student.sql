-- Сценарій: репетитор додає учня, який УЖЕ зареєстрований (27.09, жива скарга
-- власниці: «Цей email належить іншому акаунту — використайте інший»).
--
-- Причина була в тому, що `add_or_link_independent_student` питала роль ЧУЖОГО
-- користувача через `has_role(_existing, 'student')`, а жива `has_role`
-- правдива ЛИШЕ про `auth.uid()`. Тобто для будь-якого справжнього учня
-- відповідь була false → гілка «не учень, але акаунт існує» → EMAIL_NOT_STUDENT.
-- Постраждав не тестовий акаунт, а весь шлях «запросив учня → учень
-- зареєструвався → додаю його собі».
--
-- Викликаємо RPC ТАК, як це робить застосунок: під ролью authenticated із JWT
-- репетитора (сценарій, що біжить як postgres, цього класу НЕ побачить, бо
-- auth.uid() = NULL і перевірка «only tutors» падала б раніше).
-- ROLLBACK у кінці — база чиста.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  tutor uuid := gen_random_uuid();
  stud  uuid := gen_random_uuid();
  pend  uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  mgr   uuid := gen_random_uuid();
  tid   uuid;
  res jsonb;
  sid uuid;
  nm text;
  n integer;
BEGIN
  -- ── сетап: репетитор і ЗАРЕЄСТРОВАНИЙ учень ──────────────────────────────
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (tutor, 'tutor95@test.local', '{"first_name":"Оксана","last_name":"Р","role":"tutor"}'),
    (stud,  'stud95@test.local',  '{"first_name":"Настя","last_name":"Учениця","role":"student"}'),
    (other, 'other95@test.local', '{"first_name":"Інший","last_name":"Репетитор","role":"tutor"}'),
    (mgr,   'mgr95@test.local',   '{"first_name":"Менеджер","last_name":"Школи","role":"tutor"}');
  /* Роль менеджера видає лише суперадмін через create_hub, тож гард
     `guard_user_roles_writes` пускає її лише під прапорцем — ставимо його так
     само, як робить create_hub. І робимо це ТУТ, поки JWT ще не заданий:
     гард — no-op лише коли auth.uid() IS NULL. */
  PERFORM set_config('app.allow_manager_role', '1', true);
  UPDATE public.user_roles SET role = 'manager'::app_role WHERE user_id = mgr;
  PERFORM set_config('app.allow_manager_role', '0', true);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = mgr AND role = 'manager'::app_role) THEN
    RAISE EXCEPTION 'сетап: менеджер не отримав роль manager';
  END IF;
  UPDATE public.user_roles SET role = 'tutor'::app_role WHERE user_id = tutor;
  UPDATE public.user_roles SET role = 'student'::app_role WHERE user_id = stud;
  UPDATE public.user_roles SET role = 'tutor'::app_role WHERE user_id = other;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = stud AND role = 'student'::app_role) THEN
    RAISE EXCEPTION 'сетап: учень не отримав роль student';
  END IF;
  INSERT INTO public.profile_contacts (user_id, email) VALUES (stud, 'stud95@test.local')
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  INSERT INTO public.profile_contacts (user_id, email) VALUES (other, 'other95@test.local')
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

  /* Pending-профіль (рядок без акаунта) теж готуємо ТУТ: усі записи в
     `user_roles` мусять статись, поки JWT не заданий, бо `guard_user_roles_writes`
     — no-op лише при auth.uid() IS NULL, а після виклику RPC налаштування
     сесії лишаються «під людиною». */
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (pend, '', '', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (pend, 'student'::app_role)
    ON CONFLICT (user_id) DO UPDATE SET role = 'student'::app_role;
  INSERT INTO public.profile_contacts (user_id, email) VALUES (pend, 'pend95@test.local')
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

  -- ── (1) головне: додаємо ЗАРЕЄСТРОВАНОГО учня ────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.add_or_link_independent_student('Настя', 'Учениця', 'stud95@test.local', '', '', 'Англійська', 500, 'UAH');
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  IF res->>'action' <> 'linked' THEN
    RAISE EXCEPTION '(1) очікувалось action=linked, отримано %', res::text;
  END IF;
  IF (res->>'student_id')::uuid <> stud THEN
    RAISE EXCEPTION '(1) привʼязано не того учня: %', res::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.student_rates
                 WHERE tutor_id = tutor AND student_id = stud AND source = 'independent') THEN
    RAISE EXCEPTION '(1) ставка не створена — учень не став учнем репетитора';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = stud AND type = 'tutor_linked') THEN
    RAISE EXCEPTION '(1) учень не отримав сповіщення про привʼязку';
  END IF;
  RAISE NOTICE '✅ (1) зареєстрованого учня ПРИВʼЯЗАНО (action=linked) і він про це знає';

  -- ── (3) pending-профіль (рядок без акаунта) — доповнюємо імʼя ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.add_or_link_independent_student('Петро', 'Новий', 'pend95@test.local', '+380671112233', '', 'Фізика', 350, 'UAH');
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT first_name INTO nm FROM public.profiles WHERE id = pend;
  IF nm <> 'Петро' THEN
    RAISE EXCEPTION '(3) pending-профіль не доповнено імʼям: %', coalesce(nm, '<null>');
  END IF;
  RAISE NOTICE '✅ (3) pending-профіль доповнено імʼям і контактом (action=%)', res->>'action';

  -- ── (4) повторне додавання того самого учня не плодить ставок ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.add_or_link_independent_student('Настя', 'Учениця', 'stud95@test.local', '', '', 'Англійська', 500, 'UAH');
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM public.student_rates
   WHERE tutor_id = tutor AND student_id = stud AND source = 'independent' AND archived_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION '(4) ставок стало %, очікувалась одна', n; END IF;
  RAISE NOTICE '✅ (4) повторне додавання ідемпотентне — ставка одна';

  -- ── (5) тред підтримки з менеджером створюється БЕЗ уроків ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stud, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  tid := public.get_or_create_chat_thread(mgr, stud);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF tid IS NULL THEN RAISE EXCEPTION '(5) тред підтримки не створився'; END IF;
  RAISE NOTICE '✅ (5) учень відкрив тред із менеджером без жодного уроку';
  -- ── (6) звернення з лендінгу від АНОНІМА ─────────────────────────────────
  PERFORM set_config('request.headers', '{"x-forwarded-for":"203.0.113.7"}', true);
  PERFORM set_config('role', 'anon', true);
  PERFORM public.submit_landing_feedback('Чи є у вас чат підтримки?', 'oxy@example.com', '/');
  PERFORM set_config('role', 'postgres', true);

  SELECT count(*) INTO n FROM public.feedback_submissions
   WHERE category = 'landing' AND user_id IS NULL AND contact = 'oxy@example.com';
  IF n <> 1 THEN RAISE EXCEPTION '(6) анонімне звернення не збереглось (рядків %)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.feedback_submissions WHERE ip_hash = '203.0.113.7') THEN
    RAISE EXCEPTION '(6) IP збережено в чистому вигляді — так не можна';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feedback_submissions
                  WHERE category = 'landing' AND ip_hash = md5('203.0.113.7')) THEN
    RAISE EXCEPTION '(6) хеш адреси не записано — ліміт не працюватиме';
  END IF;
  RAISE NOTICE '✅ (6) анонім написав із лендінгу; відповідь піде на contact, IP лише хешем';

  /* Перевірку з ВИНЯТКОМ тримаємо ОСТАННЬОЮ. Відкат підтранзакції в
     PL/pgSQL повертає і налаштування сесії (`role`, `request.jwt.claims`),
     тож після пійманого винятку наступні кроки виконувались уже під JWT
     учня — і гард ролей чесно їх відкидав. Це пастка самого сценарію, а
     не застосунку: якщо колись додаватимеш ще один крок, став його ВИЩЕ. */
  -- ── (2) чужий акаунт РЕПЕТИТОРА лишається недоторканим ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    res := public.add_or_link_independent_student('Інший', 'Репетитор', 'other95@test.local', '', '', 'Математика', 400, 'UAH');
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION '(2) акаунт репетитора не мусив стати учнем: %', res::text;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF SQLERRM NOT LIKE '%EMAIL_NOT_STUDENT%' THEN RAISE; END IF;
    RAISE NOTICE '✅ (2) чужий акаунт репетитора відкинуто (EMAIL_NOT_STUDENT)';
  END;

  -- ── (7) ліміт 5 на годину з однієї адреси ────────────────────────────────
  PERFORM set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
  PERFORM set_config('role', 'anon', true);
  BEGIN
    FOR n IN 1..6 LOOP
      PERFORM public.submit_landing_feedback('Питання номер ' || n, NULL, '/');
    END LOOP;
    PERFORM set_config('role', 'postgres', true);
    RAISE EXCEPTION '(7) ліміт не спрацював — шосте звернення за годину пройшло';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('role', 'postgres', true);
    RAISE NOTICE '✅ (7) шосте звернення за годину відкинуто (RATE_LIMITED)';
  END;
END $$;

ROLLBACK;
