-- ОБʼЄМНИЙ ПОСІВ (17.11): школа «Велика школа» — 12 репетиторів, 150 учнів, 4 320 уроків за
-- 20 тижнів назад і 4 вперед, щодня. Усе пишеться тими самими таблицями й під тими самими
-- ролями, що й у застосунку (суперадмін підключає школу, далі все робить менеджерка), тож
-- тригери цін, виплат і членства школи спрацьовують як у житті.
--
-- Навіщо: база віддає не більше 1000 рядків за запит і мовчить про решту. На такій школі
-- «Мій день» казав «0 уроків сьогодні» (було 30), «Розклад» починався з уроків через два
-- тижні, «Фінанси» писали «Учні винні 0 ₴» при 270 950 ₴. Посів запускає `volume-walk.mjs`.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE big(k text PRIMARY KEY, v uuid);
GRANT ALL ON big TO authenticated;

DO $$
DECLARE
  sa uuid; mgr uuid := gen_random_uuid(); hub uuid; t uuid; s uuid;
  i int; j int; w int; price int; payout int; subj text; l uuid;
  subjects text[] := ARRAY['Англійська','Математика','Німецька','Українська мова','Фізика','Іспанська'];
  fn text[] := ARRAY['Олена','Ірина','Петро','Марина','Андрій','Наталія','Сергій','Юлія','Тарас','Оксана','Богдан','Ліля'];
  ln text[] := ARRAY['Шевченко','Коваленко','Бондаренко','Ткаченко','Кравченко','Олійник','Мельник','Поліщук','Гончар','Савчук','Лисенко','Мороз'];
  tutors uuid[] := '{}'; students uuid[] := '{}';
  tag text := to_char(now(), 'HH24MISS');
BEGIN
  SELECT user_id INTO sa FROM platform_admins LIMIT 1;
  IF sa IS NULL THEN RAISE EXCEPTION 'немає суперадміна на стенді'; END IF;

  -- власниця школи реєструється сама (як на сайті), суперадмін підключає школу
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (mgr, 'bigmgr-' || tag || '@big.test', now(),
          json_build_object('first_name','Вікторія','last_name','Велика','role','tutor','independent_workspace',true)::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT create_hub('Велика школа', mgr) INTO hub;
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO big VALUES ('mgr', mgr), ('hub', hub);

  -- далі все робить менеджерка
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  FOR i IN 1..12 LOOP
    t := gen_random_uuid(); tutors := tutors || t;
    INSERT INTO profiles (id, first_name, last_name, is_pending) VALUES (t, fn[i], ln[i], true);
    INSERT INTO profile_contacts (user_id, email) VALUES (t, 'bigtutor' || i || '-' || tag || '@big.test');
    INSERT INTO user_roles (user_id, role) VALUES (t, 'tutor');
    subj := subjects[1 + (i % 6)];
    payout := 300 + (i % 4) * 50;
    INSERT INTO tutor_details (user_id, subjects, rate_per_lesson) VALUES (t, ARRAY[subj], payout)
      ON CONFLICT (user_id) DO UPDATE SET subjects = EXCLUDED.subjects, rate_per_lesson = EXCLUDED.rate_per_lesson;
    INSERT INTO tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES (t, subj, payout)
      ON CONFLICT (tutor_id, subject) DO UPDATE SET rate_per_lesson = EXCLUDED.rate_per_lesson;
  END LOOP;

  FOR i IN 1..150 LOOP
    s := gen_random_uuid(); students := students || s;
    INSERT INTO profiles (id, first_name, last_name, is_pending)
      VALUES (s, fn[1 + (i % 12)], ln[1 + ((i * 7) % 12)] || ' ' || i, true);
    INSERT INTO profile_contacts (user_id, email) VALUES (s, 'bigstudent' || i || '-' || tag || '@big.test');
    INSERT INTO user_roles (user_id, role) VALUES (s, 'student');
    -- кожен учень — в одного репетитора; кожен пʼятий — ще й у другого
    FOR j IN 0..(CASE WHEN i % 5 = 0 THEN 1 ELSE 0 END) LOOP
      t := tutors[1 + ((i + j * 5) % 12)];
      subj := subjects[1 + ((1 + ((i + j * 5) % 12)) % 6)];
      price := 450 + (i % 5) * 50;
      INSERT INTO student_rates (tutor_id, student_id, subject, price_per_lesson, currency)
        VALUES (t, s, subj, price, 'UAH');
    END LOOP;
  END LOOP;

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO big SELECT 't' || n, tutors[n] FROM generate_series(1, 12) n;
  INSERT INTO big SELECT 's' || n, students[n] FROM generate_series(1, 150) n;
END $$;

-- уроки: кожна пара — раз на тиждень, 20 тижнів назад і 4 вперед; ставить менеджерка
DO $$
DECLARE mgr uuid := (SELECT v FROM big WHERE k = 'mgr'); r record; w int; n int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOR r IN
    SELECT sr.tutor_id, sr.student_id, sr.subject, row_number() OVER (ORDER BY sr.tutor_id, sr.student_id) AS rn
    FROM student_rates sr JOIN big b ON b.v = sr.tutor_id AND b.k LIKE 't%'
  LOOP
    FOR w IN -20..3 LOOP
      INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
      VALUES (r.tutor_id, r.student_id, r.subject,
              date_trunc('week', now()) + (w * 7 + (r.rn % 7)) * interval '1 day' + (8 + (r.rn % 12)) * interval '1 hour' + ((r.rn / 12) % 4) * interval '15 minutes' + (r.rn % 7) * interval '1 minute',
              60, mgr, 'hub', 'scheduled');
      n := n + 1;
    END LOOP;
  END LOOP;
  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'уроків поставлено: %', n;
END $$;
COMMIT;


-- Школа живе: минулі уроки проведено, більшість оплачено (усе, крім останніх трьох тижнів і
-- кожного сьомого уроку). Виплати репетиторам не зроблено — це окрема дія з власними правами.
BEGIN;
DO $$
DECLARE mgr uuid := (SELECT id FROM auth.users WHERE email LIKE 'bigmgr-%' ORDER BY created_at DESC LIMIT 1); n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  UPDATE lessons SET status = 'completed' WHERE created_by = mgr AND starts_at < now() - interval '1 hour' AND status = 'scheduled';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'проведено: %', n;
  -- оплачено все, крім останніх трьох тижнів і кожного сьомого уроку
  UPDATE lesson_details d SET student_payment_status = 'paid', student_paid_at = now()
    FROM lessons l WHERE l.id = d.lesson_id AND l.created_by = mgr AND l.status = 'completed'
     AND l.starts_at < now() - interval '21 days' AND (extract(epoch FROM l.starts_at)::bigint / 60) % 7 <> 0;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'оплачено учнями: %', n;
  PERFORM set_config('role', 'postgres', true);
END $$;
COMMIT;
