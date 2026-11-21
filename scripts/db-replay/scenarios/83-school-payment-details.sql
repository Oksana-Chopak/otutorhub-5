-- Сценарій 83: РЕКВІЗИТИ ШКОЛИ (21.11, рішення власниці «1–5 так», п. 5).
--
-- Учень школи бачив борг, але не бачив, куди платити: реквізити жили лише на парі
-- «учень — репетитор», а школа поля для них не мала. Тепер одне поле на школу.
-- Кожен запис робить та людина, яка робить його в застосунку (роль authenticated з її JWT).
--
-- Що доводимо:
--   (1) менеджер школи А задає реквізити — вони в його школі, школа Б не зачеплена;
--       читає їх назад; очищення порожнім рядком = «не задано»; стеля 600 знаків;
--   (2) репетитор школи й учень реквізити школи НЕ пишуть; менеджер школи Б не читає й
--       не міняє реквізити школи А; прямий UPDATE hubs — не проходить;
--   (3) учень школи А (зареєстрований запрошений) бачить реквізити своєї школи з назвою
--       школи; учень школи Б реквізитів школи А не бачить; учень самостійної — нічого;
--   (4) сторінка оплати дитини (payment_link_view) для пари школи — реквізити й назва школи;
--       для пари самостійної — її власні реквізити, без школи;
--   (5) нагадування менеджера (issue_payment_link) знає, що реквізити є; після очищення — ні;
--   (6) публічна сторінка школи реквізитів не показує.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.sub(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; q text := _q;
BEGIN
  FOR r IN SELECT k, v FROM ids LOOP q := replace(q, '{' || r.k || '}', quote_literal(r.v) || '::uuid'); END LOOP;
  RETURN q;
END $$;
CREATE FUNCTION pg_temp.run(_actor text, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE res text; q text := pg_temp.sub(_q); uid uuid := (SELECT v FROM ids WHERE k = _actor);
BEGIN
  IF _actor <> 'pg' THEN
    IF uid IS NULL THEN RAISE EXCEPTION 'невідомий актор %', _actor; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
  BEGIN
    IF q ~* '^\s*(select|with)\M' OR q ~* '\mreturning\M' THEN EXECUTE q INTO res; ELSE EXECUTE q; res := 'ok'; END IF;
  EXCEPTION WHEN OTHERS THEN
    res := '⛔ ' || SQLSTATE || ' ' || left(SQLERRM, 140);
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
  RETURN COALESCE(res, '∅');
END $$;
CREATE FUNCTION pg_temp.must(_actor text, _label text, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := pg_temp.run(_actor, _q);
BEGIN
  IF r LIKE '⛔%' THEN RAISE EXCEPTION 'ПРОВАЛ кроку «%» (%): %', _label, _actor, r; END IF;
  RETURN r;
END $$;
CREATE FUNCTION pg_temp.expect(_actor text, _label text, _q text, _want text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text := pg_temp.run(_actor, _q);
BEGIN
  IF got IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'ПРОВАЛ «%» (%): очікували «%», отримали «%»', _label, _actor, _want, got;
  END IF;
END $$;
CREATE FUNCTION pg_temp.denied(_actor text, _label text, _q text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text := pg_temp.run(_actor, _q);
BEGIN
  IF got NOT LIKE '⛔%' AND got <> '∅' AND got <> '0' THEN
    RAISE EXCEPTION 'ПРОВАЛ «%» (%): дія ПРОЙШЛА, результат «%»', _label, _actor, got;
  END IF;
END $$;
CREATE FUNCTION pg_temp.signup(_k text, _email text, _fn text, _ln text, _role text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (u, _email, now(), json_build_object('first_name', _fn, 'last_name', _ln, 'role', _role,
          'independent_workspace', _role = 'tutor')::jsonb);
  INSERT INTO ids VALUES (_k, u) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  RETURN u;
END $$;
-- менеджер додає людину у «Людях» (рівно запити addPerson)
CREATE FUNCTION pg_temp.add_person(_mgr text, _k text, _fn text, _ln text, _email text, _role text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid := gen_random_uuid();
BEGIN
  INSERT INTO ids VALUES (_k, u) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  PERFORM pg_temp.must(_mgr, 'ghost ' || _k, format('INSERT INTO profiles (id, first_name, last_name, is_pending) VALUES ({%s}, %L, %L, true)', _k, _fn, _ln));
  PERFORM pg_temp.must(_mgr, 'contacts ' || _k, format('INSERT INTO profile_contacts (user_id, email) VALUES ({%s}, %L)', _k, _email));
  PERFORM pg_temp.must(_mgr, 'role ' || _k, format('INSERT INTO user_roles (user_id, role) VALUES ({%s}, %L)', _k, _role));
  IF _role = 'tutor' THEN
    PERFORM pg_temp.must(_mgr, 'tutor_details ' || _k, format('INSERT INTO tutor_details (user_id, subjects) VALUES ({%s}, ARRAY[''Англійська'']) ON CONFLICT (user_id) DO UPDATE SET subjects = EXCLUDED.subjects RETURNING user_id', _k));
  ELSE
    PERFORM pg_temp.must(_mgr, 'student_details ' || _k, format('INSERT INTO student_details (user_id) VALUES ({%s}) ON CONFLICT (user_id) DO NOTHING RETURNING user_id', _k));
  END IF;
END $$;
CREATE FUNCTION pg_temp.register_invited(_k text, _role text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old uuid := pg_temp.id(_k); em text;
BEGIN
  SELECT email INTO em FROM profile_contacts WHERE user_id = old;
  RETURN pg_temp.signup(_k, em, 'Зареєстрований', _k, _role);
END $$;

-- ════════ дві школи і самостійна ════════
SELECT pg_temp.signup('sa',   'q83-sa@platform.test', 'Оксана', 'Суперадмін', 'tutor');
SELECT pg_temp.signup('mgrA', 'q83-a@school.test',    'Анна',   'ВласницяА',  'tutor');
SELECT pg_temp.signup('mgrB', 'q83-b@school.test',    'Богдан', 'ВласникБ',   'tutor');
SELECT pg_temp.signup('ind',  'q83-ind@tutor.test',   'Ірина',  'Самостійна', 'tutor');
INSERT INTO platform_admins (user_id) VALUES (pg_temp.id('sa')) ON CONFLICT DO NOTHING;
INSERT INTO ids SELECT 'hubA', (pg_temp.must('sa', 'create_hub A', 'SELECT create_hub(''Школа Сонях'', {mgrA})'))::uuid;
INSERT INTO ids SELECT 'hubB', (pg_temp.must('sa', 'create_hub B', 'SELECT create_hub(''Школа Б'', {mgrB})'))::uuid;

DO $$
DECLARE h text; m text;
BEGIN
  FOREACH h IN ARRAY ARRAY['A','B'] LOOP
    m := 'mgr' || h;
    PERFORM pg_temp.add_person(m, 't' || h, 'Репетитор', h, 'q83-t' || lower(h) || '@school.test', 'tutor');
    PERFORM pg_temp.add_person(m, 's' || h, 'Учень', h, 'q83-s' || lower(h) || '@fam.test', 'student');
    PERFORM pg_temp.must(m, 'pair ' || h, format('INSERT INTO student_rates (tutor_id, student_id, subject, price_per_lesson, currency) VALUES ({t%s}, {s%s}, ''Англійська'', 600, ''UAH'') RETURNING id', h, h));
    PERFORM pg_temp.must(m, 'lesson ' || h, format('INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status) VALUES ({t%s}, {s%s}, ''Англійська'', now() - interval ''1 day'', 60, {%s}, ''hub'', ''scheduled'') RETURNING id', h, h, m));
    PERFORM pg_temp.must(m, 'complete ' || h, format('UPDATE lessons SET status = ''completed'' WHERE tutor_id = {t%s} RETURNING id', h));
    PERFORM pg_temp.register_invited('t' || h, 'tutor');
    PERFORM pg_temp.register_invited('s' || h, 'student');
  END LOOP;
END $$;

-- самостійна: учень і власні реквізити пари
SELECT pg_temp.must('ind', 'ind student', 'SELECT add_or_link_independent_student(''Учень'', ''Самостійної'', ''q83-sind@fam.test'', NULL, NULL, ''Англійська'', 450, ''UAH'')');
INSERT INTO ids SELECT 'sInd', student_id FROM student_rates WHERE tutor_id = pg_temp.id('ind') LIMIT 1;
SELECT pg_temp.must('ind', 'ind details', 'UPDATE student_rates SET payment_details = ''Картка Ірини 4441'' WHERE tutor_id = {ind} RETURNING id');
SELECT pg_temp.must('ind', 'ind lesson', 'INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status) VALUES ({ind}, {sInd}, ''Англійська'', now() - interval ''1 day'', 60, {ind}, ''independent'', ''completed'') RETURNING id');

DO $$
DECLARE res jsonb; tok text; got text;
BEGIN
  -- (1) менеджер школи А задає реквізити
  PERFORM pg_temp.expect('mgrA', '(1) запис', 'SELECT set_my_hub_payment_details(''  IBAN UA21 3223 1300 0002 6007 2335 6600 1 · ФОП Сонях  '')',
    'IBAN UA21 3223 1300 0002 6007 2335 6600 1 · ФОП Сонях');
  PERFORM pg_temp.expect('mgrA', '(1) читання', 'SELECT my_hub_payment_details()', 'IBAN UA21 3223 1300 0002 6007 2335 6600 1 · ФОП Сонях');
  PERFORM pg_temp.expect('pg', '(1) школа Б не зачеплена', 'SELECT coalesce(payment_details, ''∅'') FROM hubs WHERE id = {hubB}', '∅');
  PERFORM pg_temp.expect('mgrB', '(1) менеджер Б читає лише свою', 'SELECT coalesce(my_hub_payment_details(), ''∅'')', '∅');
  PERFORM pg_temp.expect('mgrA', '(1) стеля 600', format('SELECT char_length(set_my_hub_payment_details(%L))', repeat('я', 900)), '600');
  PERFORM pg_temp.must('mgrA', 'назад', 'SELECT set_my_hub_payment_details(''IBAN UA21 3223 1300 0002 6007 2335 6600 1 · ФОП Сонях'')');
  RAISE NOTICE '✅ (1) менеджер задає реквізити своєї школи, читає їх, стеля 600 знаків, інша школа не зачеплена';

  -- (2) хто не може
  PERFORM pg_temp.denied('tA',   '(2) репетитор школи пише реквізити', 'SELECT set_my_hub_payment_details(''чужі'')');
  PERFORM pg_temp.denied('sA',   '(2) учень пише реквізити', 'SELECT set_my_hub_payment_details(''чужі'')');
  PERFORM pg_temp.denied('ind',  '(2) самостійна пише реквізити школи', 'SELECT set_my_hub_payment_details(''чужі'')');
  PERFORM pg_temp.denied('mgrB', '(2) менеджер Б — прямий UPDATE школи А', 'WITH u AS (UPDATE hubs SET payment_details = ''підміна'' WHERE id = {hubA} RETURNING 1) SELECT count(*) FROM u');
  PERFORM pg_temp.denied('mgrA', '(2) менеджер — прямий UPDATE повз функцію', 'WITH u AS (UPDATE hubs SET payment_details = ''повз'' WHERE id = {hubA} RETURNING 1) SELECT count(*) FROM u');
  PERFORM pg_temp.expect('pg', '(2) реквізити школи А цілі', 'SELECT payment_details FROM hubs WHERE id = {hubA}', 'IBAN UA21 3223 1300 0002 6007 2335 6600 1 · ФОП Сонях');
  RAISE NOTICE '✅ (2) репетитор школи, учень, самостійна і чужий менеджер реквізитів школи не змінюють';

  -- (3) учні
  PERFORM pg_temp.expect('sA', '(3) учень школи А бачить реквізити своєї школи',
    'SELECT string_agg(school_name || '' | '' || payment_details, '';'') FROM my_school_payment_details() WHERE tutor_id = {tA}',
    'Школа Сонях | IBAN UA21 3223 1300 0002 6007 2335 6600 1 · ФОП Сонях');
  PERFORM pg_temp.expect('sB', '(3) учень школи Б реквізитів школи А не бачить', 'SELECT count(*)::text FROM my_school_payment_details()', '0');
  PERFORM pg_temp.expect('sInd', '(3) учень самостійної — нічого', 'SELECT count(*)::text FROM my_school_payment_details()', '0');
  PERFORM pg_temp.expect('tA', '(3) репетитор школи — нічого (він не учень)', 'SELECT count(*)::text FROM my_school_payment_details()', '0');
  RAISE NOTICE '✅ (3) учень школи бачить, куди платити, з назвою школи; чужі учні — ні';

  -- (4) сторінка оплати дитини
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('mgrA'), 'role', 'authenticated')::text, true);
  res := public.issue_payment_link(pg_temp.id('sA'), pg_temp.id('tA'));
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF coalesce((res->>'has_requisites')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ПРОВАЛ (5): нагадування менеджера каже «реквізитів немає», хоча вони в школі є: %', res;
  END IF;
  IF coalesce((res->>'school')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ПРОВАЛ (5): нагадування не знає, що це урок школи (підказка вела б у картку учня): %', res;
  END IF;
  tok := res->>'token';
  res := public.payment_link_view(tok);
  IF res->>'requisites' IS DISTINCT FROM 'IBAN UA21 3223 1300 0002 6007 2335 6600 1 · ФОП Сонях' OR res->>'school_name' IS DISTINCT FROM 'Школа Сонях' THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): сторінка дитини школи — реквізити «%», школа «%»', res->>'requisites', res->>'school_name';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('ind'), 'role', 'authenticated')::text, true);
  res := public.issue_payment_link(pg_temp.id('sInd'), NULL);
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF coalesce((res->>'school')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'ПРОВАЛ (5): у самостійної нагадування вважає урок шкільним';
  END IF;
  res := public.payment_link_view(res->>'token');
  IF res->>'requisites' IS DISTINCT FROM 'Картка Ірини 4441' OR res->>'school_name' IS NOT NULL THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): сторінка дитини самостійної — реквізити «%», школа «%»', res->>'requisites', res->>'school_name';
  END IF;
  RAISE NOTICE '✅ (4) сторінка оплати дитини: у школи — реквізити й назва школи; у самостійної — її власні';

  -- (5) очищення
  PERFORM pg_temp.expect('mgrA', '(5) очищення', 'SELECT coalesce(set_my_hub_payment_details(''   ''), ''∅'')', '∅');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('mgrA'), 'role', 'authenticated')::text, true);
  res := public.issue_payment_link(pg_temp.id('sA'), pg_temp.id('tA'));
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF coalesce((res->>'has_requisites')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'ПРОВАЛ (5): після очищення нагадування все ще каже «реквізити є»';
  END IF;
  res := public.payment_link_view(res->>'token');
  IF res->>'requisites' IS NOT NULL THEN RAISE EXCEPTION 'ПРОВАЛ (5): після очищення сторінка дитини показує «%»', res->>'requisites'; END IF;
  PERFORM pg_temp.expect('sA', '(5) учень після очищення', 'SELECT count(*)::text FROM my_school_payment_details()', '0');
  RAISE NOTICE '✅ (5) нагадування знає, чи є реквізити школи; очищені — зникають скрізь';

  -- (6) публічна сторінка школи
  PERFORM pg_temp.must('mgrA', 'назад 2', 'SELECT set_my_hub_payment_details(''IBAN UA21 3223 1300 0002 6007 2335 6600 1'')');
  PERFORM pg_temp.must('mgrA', 'сторінка школи', 'SELECT set_hub_public_page(true, ''Англійська для дітей'')');
  SELECT public_slug INTO got FROM hubs WHERE id = pg_temp.id('hubA');
  IF public.hub_public_page(got)::text LIKE '%IBAN%' THEN
    RAISE EXCEPTION 'ПРОВАЛ (6): публічна сторінка школи показує реквізити';
  END IF;
  RAISE NOTICE '✅ (6) публічна сторінка школи реквізитів не показує';
END $$;

ROLLBACK;
