-- Сценарій 74: МЕНЕДЖЕР створює ІНДИВІДУАЛЬНИЙ урок (06.11).
--
-- Живий збій власниці: як менеджер вона завела учня, прикріпила репетитора,
-- заповнила форму уроку — і отримала «new row violates row-level security
-- policy for table "lessons"». Урок не створено, уся робота нанівець. При цьому
-- робот на проді «проходив усі ролі» — але він лише ЧИТАЄ екрани, нічого не
-- створює, тож цей клас не покривав ніхто.
--
-- Причина в клієнті: `QuickLessonDialog` виводив `source` двічі й по-різному.
-- Груповий урок — `variant === "independent" ? "independent" : "hub"`
-- (менеджер → hub, правильно), індивідуальний — `isHubVariant ? "hub" :
-- "independent"`, тож менеджер писав `source = 'independent'`. А політика
-- вставки менеджера вимагає `source = 'hub' OR source IS NULL`.
--
-- Що доводимо тут, у базі:
--   (1) менеджер МОЖЕ вставити індивідуальний урок хабового репетитора з
--       source='hub' — тобто політика не винна, винен був клієнт;
--   (2) той самий менеджер НЕ МОЖЕ вставити його з source='independent' —
--       саме це й ламалось у житті (і це правильна поведінка політики);
--   (3) ціна й виплата приходять із тригера за знімком ставок — отже клієнт не
--       має права писати ціну за менеджера.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  hub_id uuid := gen_random_uuid();
  mgr   uuid := gen_random_uuid();
  tutor uuid := gen_random_uuid();
  stud  uuid := gen_random_uuid();
  l_ok uuid;
  d record;
  denied boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr,   'mgr74@test.local',   '{"first_name":"Оксана","last_name":"Менеджер","role":"tutor"}'),
    (tutor, 'tutor74@test.local', '{"first_name":"Петро","last_name":"Городний","role":"tutor"}'),
    (stud,  'stud74@test.local',  '{"first_name":"Новий","last_name":"Учень","role":"student"}');
  INSERT INTO public.hubs (id, name, created_by) VALUES (hub_id, 'Школа сценарію 74', mgr);
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hub_id, mgr);
  DELETE FROM public.user_roles WHERE user_id = mgr AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (mgr, 'manager') ON CONFLICT DO NOTHING;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, hub_id)
    VALUES (tutor, false, hub_id)
    ON CONFLICT (tutor_id) DO UPDATE SET independent_workspace = false, hub_id = EXCLUDED.hub_id;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hub_id, tutor), (hub_id, stud) ON CONFLICT DO NOTHING;
  UPDATE public.tutor_details SET subjects = ARRAY['Математика'], rate_per_lesson = 250 WHERE user_id = tutor;
  INSERT INTO public.tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES (tutor, 'Математика', 250);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, source)
    VALUES (tutor, stud, 'Математика', 600, 'hub');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- ── (1) source='hub' — як тепер пише клієнт ────────────────────────────────
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
    VALUES (tutor, stud, 'Математика', now() + interval '1 day', 60, mgr, 'hub', 'scheduled')
    RETURNING id INTO l_ok;
  IF l_ok IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (1): менеджер не створив індивідуальний урок'; END IF;
  RAISE NOTICE '✅ (1) менеджер створив індивідуальний урок хабового репетитора';

  -- ── (2) source='independent' — як писав клієнт ДО 06.11 ─────────────────
  BEGIN
    INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
      VALUES (tutor, stud, 'Математика', now() + interval '2 day', 60, mgr, 'independent', 'scheduled');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): урок менеджера з source=independent пройшов — політика більше не ізолює гроші самостійних';
  END IF;
  RAISE NOTICE '✅ (2) той самий урок із source=independent база відбиває — саме це й бачила власниця';

  -- ── (3) гроші приходять із тригера, не від клієнта ─────────────────────────
  -- Читаємо вже НЕ як браузер: колонкові гранти 20260715000000 закривають
  -- authenticated грошові колонки lesson_details (саме через це 27.10 падала
  -- картка учня). Тут нас цікавить, що ЗАПИСАЛА база, а не що бачить клієнт.
  PERFORM set_config('role', 'postgres', true);
  SELECT student_price, tutor_payout, tutor_payout_status INTO d
    FROM public.lesson_details WHERE lesson_id = l_ok;
  IF d IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (3): тригер не створив рядок деталей'; END IF;
  IF coalesce(d.student_price, 0) <> 600 THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): ціна учня % замість 600 зі знімку ставок', d.student_price;
  END IF;
  IF coalesce(d.tutor_payout, 0) <> 250 OR coalesce(d.tutor_payout_status, '') <> 'unpaid' THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): виплата %/% замість 250/unpaid', d.tutor_payout, d.tutor_payout_status;
  END IF;
  RAISE NOTICE '✅ (3) ціна 600 і виплата 250/unpaid — зі знімку ставок, клієнт їх не пише';
END $$;

ROLLBACK;
