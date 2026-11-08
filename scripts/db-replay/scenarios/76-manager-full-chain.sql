-- Сценарій 76: МЕНЕДЖЕР робить усе своїми руками — рівно так, як клієнт (08.11).
--
-- Запит власниці: «чи тепер я можу створити ученицю, прикріплену до репетитора,
-- і чи не виникне знову помилок?». Робот на проді на це не відповідає: він лише
-- ЧИТАЄ екрани й нічого не створює. Тому ланцюг відтворено тут — тими самими
-- запитами, що їх шле застосунок, і під JWT менеджера (роль `authenticated`),
-- а не під postgres: сценарій, що біжить як postgres, не бачить ні RLS, ні
-- тригерів, які дивляться на auth.uid() (клас помилки 24.09).
--
-- Запити взято один-в-один із коду:
--   PeoplePage «Додати людину»  → profiles → profile_contacts → user_roles
--                                 → student_details
--   PeoplePage «ціна для пари»  → student_rates (БЕЗ source — як у коді)
--   QuickLessonDialog           → lessons (source='hub' після правки 06.11)
--
-- Що доводимо:
--   (1) менеджер створює ghost-профіль учениці;
--   (2) додає їй контакти;
--   (3) призначає роль student;
--   (4) заводить деталі учня;
--   (5) прикріплює репетитора ціною пари;
--   (6) ставить урок — і він з'являється;
--   (7) ціна й виплата приходять зі знімка ставок, не з клієнта;
--   (8) учениця ВИДИМА менеджерові в його ж списку людей.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  hub_id uuid := gen_random_uuid();
  mgr    uuid := gen_random_uuid();
  tutor  uuid := gen_random_uuid();
  stud   uuid := gen_random_uuid();   -- ghost: рядка в auth.users НЕМАЄ, як і в житті
  les    uuid;
  d      record;
  n      int;
BEGIN
  -- ── фікстура школи (це робить суперадмін, не менеджер) ─────────────────────
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr,   'mgr76@test.local',   '{"first_name":"Оксана","last_name":"Менеджер","role":"tutor"}'),
    (tutor, 'tutor76@test.local', '{"first_name":"Марина","last_name":"Репетиторка","role":"tutor"}');
  INSERT INTO public.hubs (id, name, created_by) VALUES (hub_id, 'Школа сценарію 76', mgr);
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hub_id, mgr);
  DELETE FROM public.user_roles WHERE user_id = mgr AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (mgr, 'manager') ON CONFLICT DO NOTHING;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, hub_id)
    VALUES (tutor, false, hub_id)
    ON CONFLICT (tutor_id) DO UPDATE SET independent_workspace = false, hub_id = EXCLUDED.hub_id;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hub_id, tutor) ON CONFLICT DO NOTHING;
  UPDATE public.tutor_details SET subjects = ARRAY['Англійська'], rate_per_lesson = 250 WHERE user_id = tutor;
  INSERT INTO public.tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES (tutor, 'Англійська', 250);

  -- ── далі ВСЕ робить сам менеджер із браузера ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- (1) ghost-профіль
  INSERT INTO public.profiles (id, first_name, last_name, is_pending)
    VALUES (stud, 'Олена', 'Нова', true);
  RAISE NOTICE '✅ (1) менеджер створив профіль учениці';

  -- (2) контакти
  INSERT INTO public.profile_contacts (user_id, email, phone)
    VALUES (stud, 'olena76@test.local', NULL);
  RAISE NOTICE '✅ (2) контакти збережено';

  -- (3) роль
  INSERT INTO public.user_roles (user_id, role) VALUES (stud, 'student');
  RAISE NOTICE '✅ (3) роль student призначено';

  -- (4) деталі учня
  INSERT INTO public.student_details (user_id) VALUES (stud)
    ON CONFLICT (user_id) DO NOTHING;
  RAISE NOTICE '✅ (4) картку учня заведено';

  -- (5) прикріплення репетитора ціною пари — рівно як у коді, БЕЗ source
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency)
    VALUES (tutor, stud, 'Англійська', 600, 'UAH');
  RAISE NOTICE '✅ (5) репетитора прикріплено (ціна пари 600)';

  -- (6) урок — так, як його тепер шле клієнт після правки 06.11
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
    VALUES (tutor, stud, 'Англійська', now() + interval '2 days', 60, mgr, 'hub', 'scheduled')
    RETURNING id INTO les;
  IF les IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (6): урок не створено'; END IF;
  RAISE NOTICE '✅ (6) урок створено';

  -- (7) гроші — зі знімка ставок, не з клієнта
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT student_price, tutor_payout, student_payment_status, tutor_payout_status
    INTO d FROM public.lesson_details WHERE lesson_id = les;
  IF d.student_price IS DISTINCT FROM 600 THEN RAISE EXCEPTION 'ПРОВАЛ (7): ціна учня % замість 600', d.student_price; END IF;
  IF d.tutor_payout IS DISTINCT FROM 250 THEN RAISE EXCEPTION 'ПРОВАЛ (7): виплата % замість 250', d.tutor_payout; END IF;
  IF d.student_payment_status <> 'unpaid' OR d.tutor_payout_status <> 'unpaid' THEN
    RAISE EXCEPTION 'ПРОВАЛ (7): статуси оплат не unpaid: % / %', d.student_payment_status, d.tutor_payout_status;
  END IF;
  RAISE NOTICE '✅ (7) ціна 600 і виплата 250 — зі знімка ставок';

  -- (8) учениця видима менеджерові в його ж списку
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.profiles WHERE id = stud;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (8): менеджер не бачить створену ученицю — вона «зникла» після додавання'; END IF;
  SELECT count(*) INTO n FROM public.lessons WHERE id = les;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (8): менеджер не бачить створений урок'; END IF;
  SELECT count(*) INTO n FROM public.lessons_visible WHERE id = les AND student_price = 600;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (8): менеджер не бачить ціну свого уроку'; END IF;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE '✅ (8) учениця, урок і ціна видимі менеджерові';
END $$;

ROLLBACK;
