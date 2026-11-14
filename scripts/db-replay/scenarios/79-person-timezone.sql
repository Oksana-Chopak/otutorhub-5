-- Сценарій: часовий пояс людини (14.11).
--   (1) людина записує СВІЙ пояс — і лише свій;
--   (2) сміття замість поясу база не приймає;
--   (3) репетитор бачить пояс свого учня, учень — пояс свого репетитора;
--   (4) стороння людина чужого поясу не бачить (RLS таблиці profiles);
--   (5) серверна функція (service_role) бачить пояси всіх, кого спитала;
--   (6) анонім викликати не може.
BEGIN;
SET LOCAL client_min_messages = notice;
DO $$
DECLARE
  tut uuid := gen_random_uuid(); stu uuid := gen_random_uuid(); oth uuid := gen_random_uuid();
  n int; tz text; caught text;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (tut, 't79@replay.local', now(), '{"first_name":"Ірина","last_name":"Київ","role":"tutor","independent_workspace":true}'),
    (stu, 's79@replay.local', now(), '{"first_name":"Соломія","last_name":"Берлін","role":"student"}'),
    (oth, 'o79@replay.local', now(), '{"first_name":"Стороння","last_name":"Людина","role":"tutor","independent_workspace":true}');
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, source)
    VALUES (tut, stu, 'Англійська', 500, 'independent');

  -- (1) кожен пише свій пояс
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tut, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.set_my_timezone('Europe/Kyiv');
  RESET role;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.set_my_timezone('Europe/Berlin');
  PERFORM public.set_my_timezone('America/Argentina/Buenos_Aires');
  PERFORM public.set_my_timezone('Europe/Berlin');
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF (SELECT timezone FROM public.profiles WHERE id = tut) IS DISTINCT FROM 'Europe/Kyiv'
     OR (SELECT timezone FROM public.profiles WHERE id = stu) IS DISTINCT FROM 'Europe/Berlin'
     OR (SELECT timezone FROM public.profiles WHERE id = oth) IS NOT NULL THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): пояси записались не тим людям';
  END IF;
  RAISE NOTICE '✅ (1) людина записує лише свій пояс';

  -- (2) сміття
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOREACH tz IN ARRAY ARRAY['', 'Europe/Berlin; drop table x', '../../etc/passwd', repeat('A', 80), '<script>'] LOOP
    caught := NULL;
    BEGIN PERFORM public.set_my_timezone(tz); EXCEPTION WHEN check_violation THEN caught := 'ok'; END;
    IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (2): база прийняла «%» як пояс', left(tz, 30); END IF;
  END LOOP;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF (SELECT timezone FROM public.profiles WHERE id = stu) IS DISTINCT FROM 'Europe/Berlin' THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): сміття змінило пояс';
  END IF;
  RAISE NOTICE '✅ (2) сміття замість поясу не приймається';

  -- (3) пара бачить пояси одне одного
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tut, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT timezone INTO tz FROM public.people_timezones(ARRAY[stu]);
  RESET role;
  IF tz IS DISTINCT FROM 'Europe/Berlin' THEN RAISE EXCEPTION 'ПРОВАЛ (3): репетитор не бачить поясу учня (%)', tz; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  tz := NULL;
  SELECT timezone INTO tz FROM public.people_timezones(ARRAY[tut]);
  RESET role;
  IF tz IS DISTINCT FROM 'Europe/Kyiv' THEN RAISE EXCEPTION 'ПРОВАЛ (3): учень не бачить поясу репетитора (%)', tz; END IF;
  RAISE NOTICE '✅ (3) репетитор і учень бачать пояси одне одного';

  -- (4) стороння людина
  PERFORM set_config('request.jwt.claims', json_build_object('sub', oth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.people_timezones(ARRAY[tut, stu]);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (4): стороння людина бачить % чужих поясів', n; END IF;
  RAISE NOTICE '✅ (4) стороння людина чужих поясів не бачить';

  -- (5) серверна функція
  PERFORM set_config('role', 'service_role', true);
  SELECT count(*) INTO n FROM public.people_timezones(ARRAY[tut, stu, oth]);
  RESET role;
  IF n <> 2 THEN RAISE EXCEPTION 'ПРОВАЛ (5): сервер бачить % поясів замість 2', n; END IF;
  RAISE NOTICE '✅ (5) серверна функція бачить пояси тих, кого спитала';

  -- (6) анонім
  IF has_function_privilege('anon', 'public.people_timezones(uuid[])', 'execute')
     OR has_function_privilege('anon', 'public.set_my_timezone(text)', 'execute') THEN
    RAISE EXCEPTION 'ПРОВАЛ (6): анонім може викликати функції поясу';
  END IF;
  RAISE NOTICE '✅ (6) анонім до поясів не дотягується';
END $$;
ROLLBACK;
