-- Сценарій 77: ПЕРША ЗОВНІШНЯ ШКОЛА — від «суперадмін підключив школу» до «усі
-- зареєструвались і працюють», під СПРАВЖНІМИ ролями (11.11).
--
-- Запит власниці: «запускаємо першу онлайн-школу — перевір кожен флоу; особливо те,
-- що повторювалось по колу: доступ ролей до фінансів, кабінет учня, кабінет хабового
-- репетитора, щоб хаби діяли окремо, а суперадмін бачив усе».
--
-- Три школи (власна школа суперадміна + дві зовнішні) і одна самостійна репетиторка.
-- Кожен запис робить та людина, яка робить його в застосунку (роль authenticated з її
-- JWT), тими самими запитами, що й клієнт. Власниці шкіл реєструються САМІ через сайт
-- (independent_workspace = true) — саме на цьому ламалось найперше.
--
-- Що доводимо:
--   (1) власниця школи після create_hub ставить уроки (було: 42501 на кожному);
--   (2) менеджер проходить увесь ланцюг: репетитор → учні → ставка → ціна пари →
--       урок → група → ціна в групі → груповий урок → передоплата;
--   (3) запрошені реєструються ПІСЛЯ того, як для них усе заведено, — і нічого не
--       губиться: id запрошеного не лишається НІДЕ в базі (перевірка по всіх
--       uuid-колонках), баланс передоплати, група, борг за групове заняття, ставки цілі;
--   (4) школи не бачать і не можуть змінити одна одну;
--   (5) репетитор школи: бачить лише свою виплату — ні контактів учнів, ні цін, ні передоплат,
--       ні заявок «я оплатив»; не піднімає собі ставку, не ставить урок «повз школу»; свою роботу робить;
--   (6) учень: бачить свої уроки, ціну й участь у групі, не бачить виплат, не позначає оплату;
--   (7) груповий урок: виплата — за ОКРЕМОЮ груповою ставкою; без неї «не задано»; «Виплатити» = сума на екрані;
--   (8) суперадмін: власна школа типово · обрана школа · вся платформа; менеджер лінзи не має;
--   (9) людину, що вже веде власних учнів, мовчки менеджером не зробити.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE obs(n serial, actor text, probe text, result text);

CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;

CREATE FUNCTION pg_temp.sub(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; q text := _q;
BEGIN
  FOR r IN SELECT k, v FROM ids LOOP q := replace(q, '{' || r.k || '}', quote_literal(r.v) || '::uuid'); END LOOP;
  RETURN q;
END $$;

-- виконати запит від імені людини; повертає текст результату або ⛔ помилку
CREATE FUNCTION pg_temp.run(_actor text, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE res text; q text := pg_temp.sub(_q); uid uuid := (SELECT v FROM ids WHERE k = _actor);
BEGIN
  IF _actor = 'anon' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('role', 'anon', true);
  ELSIF _actor <> 'pg' THEN
    IF uid IS NULL THEN RAISE EXCEPTION 'невідомий актор %', _actor; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
  BEGIN
    IF q ~* '^\s*(select|with)\M' OR q ~* '\mreturning\M' THEN
      EXECUTE q INTO res;
    ELSE
      EXECUTE q; res := 'ok';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    res := '⛔ ' || SQLSTATE || ' ' || left(SQLERRM, 140);
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
  RETURN COALESCE(res, '∅');
END $$;

CREATE FUNCTION pg_temp.probe(_actor text, _label text, _q text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO obs(actor, probe, result) VALUES (_actor, _label, pg_temp.run(_actor, _q));
END $$;

-- дія, яка МУСИТЬ пройти (крок фікстури); падає гучно
CREATE FUNCTION pg_temp.must(_actor text, _label text, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := pg_temp.run(_actor, _q);
BEGIN
  IF r LIKE '⛔%' THEN
    INSERT INTO obs(actor, probe, result) VALUES (_actor, 'КРОК ' || _label, r);
    RAISE EXCEPTION 'ПРОВАЛ кроку «%» (%): %', _label, _actor, r;
  END IF;
  RETURN r;
END $$;

-- реєстрація акаунта (як GoTrue): рядок auth.users з підтвердженою поштою
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

-- запрошений реєструється зі своєї пошти (злиття pending-профілю)
CREATE FUNCTION pg_temp.register_invited(_k text, _role text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old uuid := pg_temp.id(_k); em text;
BEGIN
  SELECT email INTO em FROM profile_contacts WHERE user_id = old;
  INSERT INTO ids VALUES (_k || '_ghost', old);
  RETURN pg_temp.signup(_k, em, 'Зареєстрований', _k, _role);
END $$;

-- ════════ акаунти, що реєструються самі ════════
SELECT pg_temp.signup('sa',   'oksana@platform.test', 'Оксана', 'Суперадмін', 'tutor');
SELECT pg_temp.signup('mgrA', 'owner-a@school.test',  'Анна',   'ВласницяА',  'tutor');
SELECT pg_temp.signup('mgrB', 'owner-b@school.test',  'Богдан', 'ВласникБ',   'tutor');
SELECT pg_temp.signup('ind',  'ind@tutor.test',       'Ірина',  'Незалежна',  'tutor');
INSERT INTO platform_admins (user_id) VALUES (pg_temp.id('sa'));

-- ════════ суперадмін підключає школи (SchoolsCard → create_hub) ════════
INSERT INTO ids SELECT 'hubS', (pg_temp.must('sa', 'create_hub S', 'SELECT create_hub(''Моя школа'', {sa})'))::uuid;
INSERT INTO ids SELECT 'hubA', (pg_temp.must('sa', 'create_hub A', 'SELECT create_hub(''Школа А'', {mgrA})'))::uuid;
INSERT INTO ids SELECT 'hubB', (pg_temp.must('sa', 'create_hub B', 'SELECT create_hub(''Школа Б'', {mgrB})'))::uuid;

-- ════════ кожна школа: репетитор, 2 учні, ставки, уроки, група ════════
DO $$
DECLARE h text; m text; t text; s1 text; s2 text; g text; l text; lg text; r text; price int; payout int;
BEGIN
  FOREACH h IN ARRAY ARRAY['S','A','B'] LOOP
    m  := CASE h WHEN 'S' THEN 'sa' ELSE 'mgr' || h END;
    t  := 't' || h; s1 := 's' || h || '1'; s2 := 's' || h || '2'; g := 'g' || h; l := 'l' || h; lg := 'lg' || h;
    price := CASE h WHEN 'S' THEN 500 WHEN 'A' THEN 600 ELSE 700 END;
    payout := CASE h WHEN 'S' THEN 300 WHEN 'A' THEN 350 ELSE 400 END;
    PERFORM pg_temp.add_person(m, t,  'Репетитор', h, 'tutor-' || lower(h) || '@school.test', 'tutor');
    PERFORM pg_temp.add_person(m, s1, 'Учень1',    h, 's1-' || lower(h) || '@fam.test', 'student');
    PERFORM pg_temp.add_person(m, s2, 'Учень2',    h, 's2-' || lower(h) || '@fam.test', 'student');
    IF h <> 'A' THEN  -- у школах S і Б запрошені реєструються ОДРАЗУ; у школі А — після всього (нижче)
      PERFORM pg_temp.register_invited(t, 'tutor');
      PERFORM pg_temp.register_invited(s1, 'student');
    END IF;
    -- ставка репетитора (TutorRateDialog)
    PERFORM pg_temp.must(m, 'rate td ' || t, format('UPDATE tutor_details SET rate_per_lesson = %s WHERE user_id = {%s} RETURNING user_id', payout, t));
    PERFORM pg_temp.must(m, 'rate tsr ' || t, format('INSERT INTO tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES ({%s}, ''Англійська'', %s) ON CONFLICT (tutor_id, subject) DO UPDATE SET rate_per_lesson = EXCLUDED.rate_per_lesson RETURNING tutor_id', t, payout));
    IF h = 'B' THEN  -- ставка за ГРУПОВЕ заняття (форма ставки репетитора) — лише в школі Б
      PERFORM pg_temp.must(m, 'group rate ' || t, format('UPDATE tutor_details SET group_rate_per_lesson = 250 WHERE user_id = {%s} RETURNING user_id', t));
    END IF;
    -- ціна пари (People → student_rates без source)
    PERFORM pg_temp.must(m, 'pair ' || s1, format('INSERT INTO student_rates (tutor_id, student_id, subject, price_per_lesson, currency) VALUES ({%s}, {%s}, ''Англійська'', %s, ''UAH'') RETURNING id', t, s1, price));
    PERFORM pg_temp.must(m, 'pair ' || s2, format('INSERT INTO student_rates (tutor_id, student_id, subject, price_per_lesson, currency) VALUES ({%s}, {%s}, ''Англійська'', %s, ''UAH'') RETURNING id', t, s2, price));
    -- індивідуальний урок (вчора) + позначити проведеним
    r := pg_temp.must(m, 'lesson ' || l, format('INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status) VALUES ({%s}, {%s}, ''Англійська'', now() - interval ''1 day'', 60, {%s}, ''hub'', ''scheduled'') RETURNING id', t, s1, m));
    IF r NOT LIKE '⛔%' THEN INSERT INTO ids VALUES (l, r::uuid); END IF;
    PERFORM pg_temp.must(m, 'complete ' || l, format('UPDATE lessons SET status = ''completed'' WHERE id = {%s} RETURNING id', l));
    -- група (createGroupWithStudents) + ціна учасника + груповий урок (createGroupLesson)
    r := pg_temp.must(m, 'group ' || g, format('INSERT INTO lesson_groups (tutor_id, name, subject) VALUES ({%s}, ''Група %s'', ''Англійська'') RETURNING id', t, h));
    IF r NOT LIKE '⛔%' THEN INSERT INTO ids VALUES (g, r::uuid); END IF;
    PERFORM pg_temp.must(m, 'enroll ' || g, format('WITH i AS (INSERT INTO group_enrollments (group_id, student_id, status, price_per_lesson) VALUES ({%s}, {%s}, ''active'', NULL), ({%s}, {%s}, ''active'', NULL) RETURNING id) SELECT count(*) FROM i', g, s1, g, s2));
    PERFORM pg_temp.must(m, 'group price ' || g, format('SELECT set_group_enrollment_price(e.id, 200) FROM group_enrollments e WHERE e.group_id = {%s} LIMIT 1', g));
    PERFORM pg_temp.must(m, 'group price2 ' || g, format('SELECT count(*) FROM (SELECT set_group_enrollment_price(e.id, 200) FROM group_enrollments e WHERE e.group_id = {%s}) x', g));
    r := pg_temp.must(m, 'glesson ' || lg, format('INSERT INTO lessons (tutor_id, student_id, group_id, lesson_type, subject, starts_at, duration_minutes, status, created_by, source) VALUES ({%s}, NULL, {%s}, ''pair'', ''Англійська'', now() - interval ''2 days'', 60, ''scheduled'', {%s}, ''hub'') RETURNING id', t, g, m));
    IF r NOT LIKE '⛔%' THEN INSERT INTO ids VALUES (lg, r::uuid); END IF;
    PERFORM pg_temp.must(m, 'gparts ' || lg, format('WITH i AS (INSERT INTO lesson_participants (lesson_id, student_id, student_price, currency, student_payment_status) SELECT {%s}, e.student_id, e.price_per_lesson, COALESCE(e.currency, ''UAH''), ''unpaid'' FROM group_enrollments_visible e WHERE e.group_id = {%s} AND e.status = ''active'' RETURNING id) SELECT count(*) FROM i', lg, g));
    PERFORM pg_temp.must(m, 'gcomplete ' || lg, format('UPDATE lessons SET status = ''completed'' WHERE id = {%s} RETURNING id', lg));
  END LOOP;
END $$;

-- ════════ школа А: запрошені реєструються ПІСЛЯ того, як для них уже все заведено ════════
SELECT pg_temp.must('mgrA', 'topup A s1', 'SELECT wallet_topup({tA}, {sA1}, 0, 5000, ''передоплата до реєстрації'')');
SELECT pg_temp.register_invited('tA', 'tutor'), pg_temp.register_invited('sA1', 'student');

-- ════════ незалежна репетиторка: учень і урок ════════
SELECT pg_temp.must('ind', 'ind student', 'SELECT add_or_link_independent_student(''Учень'', ''Незалежної'', ''sind@fam.test'', NULL, NULL, ''Англійська'', 450, ''UAH'')');
INSERT INTO ids SELECT 'sInd', student_id FROM student_rates WHERE tutor_id = pg_temp.id('ind') LIMIT 1;
INSERT INTO ids SELECT 'lInd', (pg_temp.must('ind', 'ind lesson', 'INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status) VALUES ({ind}, {sInd}, ''Англійська'', now() - interval ''1 day'', 60, {ind}, ''independent'', ''scheduled'') RETURNING id'))::uuid;
SELECT pg_temp.must('ind', 'ind complete', 'UPDATE lessons SET status = ''completed'' WHERE id = {lInd} RETURNING id');

-- ════════ додаткові сліди в кожній школі: гаманець, тред, нотатка менеджера ════════
DO $$
DECLARE h text; m text;
BEGIN
  FOREACH h IN ARRAY ARRAY['S','A','B'] LOOP
    m := CASE h WHEN 'S' THEN 'sa' ELSE 'mgr' || h END;
    PERFORM pg_temp.must(m, 'topup ' || h, format('SELECT wallet_topup({t%s}, {s%s2}, 0, 100, ''передоплата'')', h, h));
    PERFORM pg_temp.must(m, 'thread ' || h, format('SELECT get_or_create_chat_thread({t%s}, {s%s1})', h, h));
    PERFORM pg_temp.must(m, 'note ' || h, format('INSERT INTO manager_notes (subject_user_id, author_id, content) VALUES ({t%s}, {%s}, ''нотатка школи %s'')', h, m, h));
  END LOOP;
END $$;

-- ════════ перевірки ════════
CREATE FUNCTION pg_temp.expect(_actor text, _label text, _q text, _want text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text := pg_temp.run(_actor, _q);
BEGIN
  IF got IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'ПРОВАЛ «%» (%): очікували «%», отримали «%»', _label, _actor, _want, got;
  END IF;
END $$;
-- дія, яку база МУСИТЬ відбити (помилкою або нулем змінених рядків), і стан після неї
CREATE FUNCTION pg_temp.denied(_actor text, _label text, _q text, _state_q text DEFAULT NULL, _state_want text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text; st text;
BEGIN
  got := pg_temp.run(_actor, _q);
  IF got NOT LIKE '⛔%' AND got <> '∅' AND got <> '0' THEN
    IF _state_q IS NULL THEN
      RAISE EXCEPTION 'ПРОВАЛ «%» (%): дія ПРОЙШЛА, результат «%»', _label, _actor, got;
    END IF;
  END IF;
  IF _state_q IS NOT NULL THEN
    st := pg_temp.run('pg', _state_q);
    IF st IS DISTINCT FROM _state_want THEN
      RAISE EXCEPTION 'ПРОВАЛ «%» (%): після спроби стан «%», мав лишитись «%»', _label, _actor, st, _state_want;
    END IF;
  END IF;
END $$;

DO $$
DECLARE n int; r record; g text; leftover text := '';
BEGIN
  -- (1) власниці шкіл — менеджери, не «самостійні репетитори»
  IF EXISTS (SELECT 1 FROM tutor_workspace_settings s JOIN hub_managers hm ON hm.user_id = s.tutor_id WHERE s.independent_workspace) THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): менеджер школи лишився з independent_workspace = true';
  END IF;
  RAISE NOTICE '✅ (1) власниця школи, що зареєструвалась сама, після create_hub ставить уроки';
  RAISE NOTICE '✅ (2) менеджер пройшов увесь ланцюг: репетитор → учні → ставка → пара → урок → група → груповий урок → передоплата';

  -- (3) після пізньої реєстрації id запрошених не лишилось НІДЕ
  FOR g IN SELECT k FROM ids WHERE k LIKE '%\_ghost' LOOP
    FOR r IN SELECT c.table_name, c.column_name FROM information_schema.columns c
              JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace AND k.relkind = 'r'
             WHERE c.table_schema = 'public' AND c.data_type = 'uuid'
               AND c.table_name <> 'manager_audit_log'   -- журнал дій — історія, не переписується
             LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.table_name, r.column_name) INTO n USING pg_temp.id(g);
      IF n > 0 THEN leftover := leftover || format(' %s.%s(%s×%s)', r.table_name, r.column_name, g, n); END IF;
    END LOOP;
  END LOOP;
  IF leftover <> '' THEN RAISE EXCEPTION 'ПРОВАЛ (3): після реєстрації запрошеного його старий id лишився в:%', leftover; END IF;
  SELECT string_agg(left(message, 160), ' ¦ ') INTO leftover FROM error_log WHERE message LIKE 'merge_pending_profile%';
  IF leftover IS NOT NULL THEN RAISE EXCEPTION 'ПРОВАЛ (3): злиття записало збої: %', leftover; END IF;
END $$;
SELECT pg_temp.expect('mgrA', '(3) передоплата учня ціла після його реєстрації', $q$SELECT amount_balance::text FROM get_wallet_balance({tA},{sA1})$q$, '4400.00');
SELECT pg_temp.expect('mgrA', '(3) група й обидва учні на місці', $q$SELECT count(*)::text FROM group_enrollments_visible WHERE group_id = {gA} AND status = 'active'$q$, '2');
SELECT pg_temp.expect('mgrA', '(3) борг за групове заняття не зник', $q$SELECT count(*)||'/'||sum(student_price) FROM lesson_participants_visible WHERE lesson_id = {lgA}$q$, '2/400');
SELECT pg_temp.expect('mgrA', '(3) ставка репетитора за предметом на місці', $q$SELECT rate_per_lesson::text FROM tutor_subject_rates WHERE tutor_id = {tA}$q$, '350.00');
SELECT pg_temp.expect('sA1', '(3) учениця бачить і індивідуальний, і груповий урок', $q$SELECT count(*)::text FROM lessons_visible$q$, '2');
SELECT pg_temp.expect('tA', '(3) репетитор після реєстрації бачить свою групу', $q$SELECT count(*)::text FROM lesson_groups$q$, '1');
DO $$ BEGIN RAISE NOTICE '✅ (3) запрошені зареєструвались після налаштування — передоплата, група, борг за групу, ставки й уроки цілі; старого id немає ніде'; END $$;

-- (4) школи окремо
SELECT pg_temp.expect('mgrA', '(4) менеджер А бачить лише свої уроки', $q$SELECT count(*)||'/'||sum(student_price) FROM lessons_visible$q$, '2/600.00');
SELECT pg_temp.expect('mgrB', '(4) менеджер Б бачить лише свої уроки', $q$SELECT count(*)||'/'||sum(student_price) FROM lessons_visible$q$, '2/700.00');
SELECT pg_temp.expect('mgrA', '(4) менеджер А не бачить людей школи Б', $q$SELECT count(*)::text FROM profiles WHERE id IN ({tB},{sB1},{sB2},{mgrB})$q$, '0');
SELECT pg_temp.expect('mgrA', '(4) менеджер А не бачить цін, груп, гаманців школи Б', $q$SELECT (SELECT count(*) FROM student_rates WHERE tutor_id = {tB})||'/'||(SELECT count(*) FROM lesson_groups WHERE tutor_id = {tB})||'/'||(SELECT count(*) FROM student_wallet_transactions WHERE tutor_id = {tB})||'/'||(SELECT count(*) FROM tutor_subject_rates WHERE tutor_id = {tB})$q$, '0/0/0/0');
SELECT pg_temp.denied('mgrA', '(4) змінити урок школи Б', $q$UPDATE lessons SET status = 'cancelled' WHERE id = {lB} RETURNING status$q$, $q$SELECT status::text FROM lessons WHERE id = {lB}$q$, 'completed');
SELECT pg_temp.denied('mgrA', '(4) оплата уроку школи Б', $q$SELECT update_lesson_details_safe({lB}, '{"student_payment_status": "paid"}'::jsonb)$q$, $q$SELECT student_payment_status FROM lesson_details WHERE lesson_id = {lB}$q$, 'unpaid');
SELECT pg_temp.denied('mgrA', '(4) виплата репетитору школи Б', $q$SELECT mark_tutor_payouts_paid({tB})$q$, $q$SELECT tutor_payout_status FROM lesson_details WHERE lesson_id = {lB}$q$, 'unpaid');
SELECT pg_temp.denied('mgrA', '(4) гаманець школи Б', $q$SELECT wallet_topup({tB}, {sB1}, 0, 100, 'x')$q$);
SELECT pg_temp.denied('mgrA', '(4) урок на репетитора школи Б', $q$INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status) VALUES ({tB}, {sB1}, 'x', now(), 60, {mgrA}, 'hub', 'scheduled') RETURNING id$q$);
SELECT pg_temp.denied('mgrA', '(4) ставка репетитора школи Б', $q$INSERT INTO tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES ({tB}, 'x', 1) RETURNING tutor_id$q$);
SELECT pg_temp.denied('mgrA', '(4) переманити репетитора школи Б', $q$INSERT INTO user_roles (user_id, role) VALUES ({tB}, 'tutor') ON CONFLICT (user_id) DO UPDATE SET role = 'tutor' RETURNING user_id$q$, $q$SELECT (SELECT name FROM hubs h WHERE h.id = s.hub_id) FROM tutor_workspace_settings s WHERE tutor_id = {tB}$q$, 'Школа Б');
SELECT pg_temp.denied('mgrA', '(4) захопити самостійну репетиторку', $q$INSERT INTO user_roles (user_id, role) VALUES ({ind}, 'tutor') ON CONFLICT (user_id) DO UPDATE SET role = 'tutor' RETURNING user_id$q$, $q$SELECT independent_workspace::text||'/'||coalesce(hub_id::text, 'без школи') FROM tutor_workspace_settings WHERE tutor_id = {ind}$q$, 'true/без школи');
SELECT pg_temp.denied('mgrA', '(4) стати менеджером школи Б', $q$INSERT INTO hub_managers (hub_id, user_id) VALUES ({hubB}, {mgrA}) RETURNING user_id$q$);
SELECT pg_temp.denied('mgrA', '(4) стати адміном платформи', $q$INSERT INTO platform_admins (user_id) VALUES ({mgrA}) RETURNING user_id$q$);
SELECT pg_temp.denied('mgrA', '(4) створити школу', $q$SELECT create_hub('x', {tA})$q$);
SELECT pg_temp.denied('mgrA', '(4) видати роль manager', $q$UPDATE user_roles SET role = 'manager' WHERE user_id = {tA} RETURNING role$q$, $q$SELECT role::text FROM user_roles WHERE user_id = {tA}$q$, 'tutor');
SELECT pg_temp.denied('mgrA', '(4) видалити учня школи Б', $q$SELECT manager_purge_user({sB1})$q$, $q$SELECT count(*)::text FROM profiles WHERE id = {sB1}$q$, '1');
SELECT pg_temp.denied('mgrA', '(4) сповістити учня школи Б', $q$SELECT create_notification({sB1}, 'x', 'привіт')$q$);
SELECT pg_temp.expect('ind', '(4) самостійна репетиторка не бачить шкіл', $q$SELECT (SELECT count(*) FROM hubs)||'/'||(SELECT count(*) FROM lessons_visible)||'/'||(SELECT count(*) FROM profiles)$q$, '0/1/2');
DO $$ BEGIN RAISE NOTICE '✅ (4) школи А і Б не бачать і не можуть змінити одна одну; самостійна репетиторка — поза школами'; END $$;

-- (5) репетитор школи
SELECT pg_temp.expect('tB', '(5) репетитор школи: ціни учня не бачить, свою виплату бачить (індивідуальний 400 + груповий 250)', $q$SELECT count(*)||'/'||coalesce(sum(student_price)::text, 'ціни немає')||'/'||sum(tutor_payout) FROM lessons_visible$q$, '2/ціни немає/650.00');
SELECT pg_temp.expect('tB', '(5) ціни учасників групи не бачить', $q$SELECT count(*)||'/'||coalesce(sum(student_price)::text, 'ціни немає') FROM lesson_participants_visible$q$, '2/ціни немає');
SELECT pg_temp.expect('tB', '(5) боргів учнів перед школою не бачить (бот, знімок)', $q$SELECT (tutor_snapshot({tB})->>'debt_sum')||'/'||(tutor_snapshot({tB})->>'debt_lessons')$q$, '0/0');
SELECT pg_temp.expect('tB', '(5) контактів учнів не бачить — лише свій', $q$SELECT count(*)::text FROM profile_contacts$q$, '1');
SELECT pg_temp.expect('tB', '(5) контакту батьків (картка учня) не бачить', $q$SELECT count(*)::text FROM student_details$q$, '0');
SELECT pg_temp.expect('tB', '(5) передоплат школи не бачить', $q$SELECT (SELECT count(*) FROM student_wallet_transactions)||'/'||(SELECT count(*) FROM student_wallet_balances)$q$, '0/0');
SELECT pg_temp.denied('tB', '(5) баланс передоплати через RPC', $q$SELECT amount_balance::text FROM get_wallet_balance({tB},{sB2})$q$);
SELECT pg_temp.expect('tB', '(5) пари бачить, ціни в них — ні', $q$SELECT count(*)||'/'||coalesce(sum(price_per_lesson)::text, 'ціни немає') FROM student_pairs_visible$q$, '2/ціни немає');
-- крок 2 (20261111200000): напряму з таблиці репетитор школи рядків школи не читає взагалі,
-- а урок своєму учневі школи ставить, як і раніше (політика йде через tutor_has_pair)
SELECT pg_temp.expect('tB', '(5) напряму з таблиці пар школи репетитор не читає нічого', $q$SELECT count(*)::text FROM student_rates$q$, '0');
SELECT pg_temp.expect('ind', '(5) самостійна свої пари з таблиці читає', $q$SELECT (count(*) > 0)::text FROM student_rates$q$, 'true');
SELECT pg_temp.expect('mgrB', '(5) менеджер у тих самих парах ціну бачить', $q$SELECT count(*)||'/'||sum(price_per_lesson) FROM student_pairs_visible$q$, '2/1400.00');
SELECT pg_temp.expect('sB1', '(5) учень бачить свою пару й свою ціну', $q$SELECT count(*)||'/'||sum(price_per_lesson) FROM student_pairs_visible$q$, '1/700.00');
SELECT pg_temp.expect('mgrA', '(5) менеджер А пар школи Б у вʼю не бачить', $q$SELECT count(*)::text FROM student_pairs_visible WHERE tutor_id = {tB}$q$, '0');
SELECT pg_temp.expect('ind', '(5) самостійна: свої пари з ціною, контакт і картка свого учня', $q$SELECT (SELECT sum(price_per_lesson) FROM student_pairs_visible)||'/'||(SELECT count(*) FROM profile_contacts WHERE user_id = {sInd})||'/'||(SELECT count(*) FROM student_details WHERE user_id = {sInd})$q$, '450.00/1/1');
SELECT pg_temp.expect('tB', '(5) «повернуто нагадуваннями» репетитору школи не рахуємо', $q$SELECT tutor_value_stats({tB})::text||tutor_reminder_stats({tB})::text$q$, '{}{}');
SELECT pg_temp.denied('tB', '(5) підняти собі ставку за групове', $q$UPDATE tutor_details SET group_rate_per_lesson = 2000 WHERE user_id = {tB} RETURNING group_rate_per_lesson$q$, $q$SELECT group_rate_per_lesson::text FROM tutor_details WHERE user_id = {tB}$q$, '250.00');
SELECT pg_temp.denied('tB', '(5) посилання на оплату з сумою боргу', $q$SELECT issue_payment_link({sB1})->>'total'$q$);
SELECT pg_temp.denied('tB', '(5) підняти собі ставку за предметом', $q$UPDATE tutor_subject_rates SET rate_per_lesson = 1000 WHERE tutor_id = {tB} RETURNING rate_per_lesson$q$, $q$SELECT rate_per_lesson::text FROM tutor_subject_rates WHERE tutor_id = {tB}$q$, '400.00');
SELECT pg_temp.denied('tB', '(5) додати собі ставку за новим предметом', $q$INSERT INTO tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES ({tB}, 'Математика', 1000) RETURNING rate_per_lesson$q$);
SELECT pg_temp.denied('tB', '(5) підняти собі ставку в профілі', $q$UPDATE tutor_details SET rate_per_lesson = 1000 WHERE user_id = {tB} RETURNING rate_per_lesson$q$, $q$SELECT rate_per_lesson::text FROM tutor_details WHERE user_id = {tB}$q$, '400.00');
SELECT pg_temp.expect('tB', '(5) свої предмети й «про себе» редагує', $q$UPDATE tutor_details SET bio = 'викладаю 10 років' WHERE user_id = {tB} RETURNING bio$q$, 'викладаю 10 років');
SELECT pg_temp.denied('tB', '(5) виплата 999 на своєму уроці', $q$SELECT update_lesson_details_safe({lB}, '{"tutor_payout": 999}'::jsonb)$q$, $q$SELECT tutor_payout::text FROM lesson_details WHERE lesson_id = {lB}$q$, '400.00');
SELECT pg_temp.denied('tB', '(5) позначити оплату учня', $q$SELECT update_lesson_details_safe({lB}, '{"student_payment_status": "paid"}'::jsonb)$q$, $q$SELECT student_payment_status FROM lesson_details WHERE lesson_id = {lB}$q$, 'unpaid');
SELECT pg_temp.denied('tB', '(5) виплатити собі', $q$SELECT mark_tutor_payouts_paid({tB})$q$, $q$SELECT tutor_payout_status FROM lesson_details WHERE lesson_id = {lB}$q$, 'unpaid');
SELECT pg_temp.denied('tB', '(5) урок «повз школу» з учнем школи', $q$INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status) VALUES ({tB}, {sB1}, 'Англійська', now() + interval '1 day', 60, {tB}, 'independent', 'scheduled') RETURNING source$q$, $q$SELECT count(*)::text FROM lessons WHERE tutor_id = {tB} AND source = 'independent'$q$, '0');
SELECT pg_temp.denied('tB', '(5) вийти зі школи самому', $q$SELECT set_own_independent_workspace()$q$, $q$SELECT independent_workspace::text FROM tutor_workspace_settings WHERE tutor_id = {tB}$q$, 'false');
SELECT pg_temp.denied('tB', '(5) змінити ціну пари', $q$UPDATE student_rates SET price_per_lesson = 1 WHERE tutor_id = {tB} RETURNING price_per_lesson$q$, $q$SELECT min(price_per_lesson)::text FROM student_rates WHERE tutor_id = {tB}$q$, '700.00');
SELECT pg_temp.denied('tB', '(5) роль manager собі', $q$UPDATE user_roles SET role = 'manager' WHERE user_id = {tB} RETURNING role$q$, $q$SELECT role::text FROM user_roles WHERE user_id = {tB}$q$, 'tutor');
INSERT INTO ids SELECT 'lB2', (pg_temp.must('tB', 'репетитор школи ставить свій урок', $q$INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status) VALUES ({tB}, {sB1}, 'Англійська', now() + interval '1 day', 60, {tB}, 'hub', 'scheduled') RETURNING id$q$))::uuid;
SELECT pg_temp.expect('pg', '(5) урок від репетитора школи: ціна й виплата зі знімка ставок', $q$SELECT student_price||'/'||tutor_payout||'/'||tutor_payout_status FROM lesson_details WHERE lesson_id = {lB2}$q$, '700.00/400.00/unpaid');
SELECT pg_temp.must('tB', 'домашка на своєму уроці', $q$SELECT update_lesson_details_safe({lB}, '{"homework": "вправа 5"}'::jsonb)$q$);
SELECT pg_temp.expect('mgrB', '(5) урок репетитора видно його менеджеру', $q$SELECT count(*)::text FROM lessons_visible WHERE id = {lB2} AND student_price = 700$q$, '1');
SELECT pg_temp.expect('pg', '(5) заявку «я оплатив» репетитор школи не бачить, менеджер бачить', $q$SELECT 'перевіряється в (6)'$q$, 'перевіряється в (6)');
DO $$ BEGIN RAISE NOTICE '✅ (5) репетитор школи: лише своя виплата — ні контактів учнів, ні цін, ні передоплат; ставку собі не підніме, урок «повз школу» не поставить; свій урок і домашку — робить'; END $$;

-- (6) учень
SELECT pg_temp.expect('sB1', '(6) учень: свої уроки, ціна своя, виплат не видно', $q$SELECT count(*)||'/'||sum(student_price)||'/'||coalesce(sum(tutor_payout)::text, 'виплат не видно') FROM lessons_visible WHERE starts_at < now()$q$, '2/700.00/виплат не видно');
SELECT pg_temp.expect('sB1', '(6) учень: участь у групі й своя ціна в ній', $q$SELECT count(*)||'/'||sum(student_price) FROM lesson_participants_visible$q$, '1/200');
SELECT pg_temp.expect('sB1', '(6) учень: домашку бачить', $q$SELECT homework FROM lesson_details_student WHERE lesson_id = {lB}$q$, 'вправа 5');
SELECT pg_temp.expect('sB1', '(6) учень: чужих учнів і ставок репетитора не бачить', $q$SELECT (SELECT count(*) FROM profiles WHERE id = {sB2})||'/'||(SELECT count(*) FROM tutor_subject_rates)||'/'||(SELECT count(*) FROM tutor_details)$q$, '0/0/0');
SELECT pg_temp.denied('sB1', '(6) учень позначає свій урок оплаченим', $q$SELECT update_lesson_details_safe({lB}, '{"student_payment_status": "paid"}'::jsonb)$q$, $q$SELECT student_payment_status FROM lesson_details WHERE lesson_id = {lB}$q$, 'unpaid');
SELECT pg_temp.denied('sB1', '(6) учень позначає оплату в групі', $q$SELECT set_group_participant_payment(ARRAY(SELECT id FROM lesson_participants WHERE lesson_id = {lgB}), 'paid')$q$, $q$SELECT count(*)::text FROM lesson_participants WHERE lesson_id = {lgB} AND student_payment_status = 'paid'$q$, '0');
SELECT pg_temp.denied('sB1', '(6) учень поповнює собі гаманець', $q$SELECT wallet_topup({tB}, {sB1}, 0, 9999, 'x')$q$);
SELECT pg_temp.denied('sB1', '(6) учень міняє ціну пари', $q$UPDATE student_rates SET price_per_lesson = 1 WHERE student_id = {sB1} RETURNING price_per_lesson$q$, $q$SELECT price_per_lesson::text FROM student_rates WHERE student_id = {sB1}$q$, '700.00');
SELECT pg_temp.expect('sB1', '(6) «я оплатив(ла)» проходить', $q$SELECT create_payment_claim({tB}, 700, NULL)->>'ok'$q$, 'true');
SELECT pg_temp.expect('tB', '(6) заявку із сумою репетитор школи не бачить', $q$SELECT count(*)::text FROM payment_claims$q$, '0');
SELECT pg_temp.expect('mgrB', '(6) а менеджер школи бачить', $q$SELECT count(*)||'/'||sum(amount) FROM payment_claims$q$, '1/700.00');
DO $$ BEGIN RAISE NOTICE '✅ (6) учень: свої уроки, ціна, група й домашка — є; виплат і чужого — немає; оплату собі не позначить, «я оплатив(ла)» працює'; END $$;

-- (7) груповий урок: виплата — за окремою груповою ставкою; без неї — «не задано»
SELECT pg_temp.expect('pg', '(7) де групової ставки немає (школи S і А) — виплата 0, індивідуальну не підставлено', $q$SELECT string_agg(coalesce(d.tutor_payout, 0)::text, ',' ORDER BY l.tutor_id = {tB}) FROM lessons l JOIN lesson_details d ON d.lesson_id = l.id WHERE l.group_id IS NOT NULL AND l.starts_at < now() AND l.tutor_id <> {tB}$q$, '0,0');
SELECT pg_temp.expect('pg', '(7) де групова ставка є (школа Б) — саме вона, 250, не 400', $q$SELECT d.tutor_payout||'/'||d.tutor_payout_status FROM lesson_details d WHERE d.lesson_id = {lgB}$q$, '250.00/unpaid');
SELECT pg_temp.expect('mgrB', '(7) «до виплати» на екрані менеджера: індивідуальний 400 + груповий 250', $q$SELECT payouts_count||'/'||payouts_owed FROM manager_debts_summary()$q$, '2/650.00');
SELECT pg_temp.expect('mgrB', '(7) «Виплатити» закрило рівно стільки ж уроків', $q$SELECT mark_tutor_payouts_paid({tB})::text$q$, '2');
SELECT pg_temp.expect('mgrB', '(7) у витратах періоду — обидві виплати', $q$SELECT finances_period_totals(now() - interval '30 days')->>'paid_expense'$q$, '650.00');
SELECT pg_temp.must('mgrA', 'менеджер А задає групову ставку заднім числом', $q$UPDATE tutor_details SET group_rate_per_lesson = 180 WHERE user_id = {tA} RETURNING user_id$q$);
SELECT pg_temp.expect('mgrA', '(7) збереження ставки дотягує вже проведений груповий урок', $q$SELECT backfill_tutor_payouts_for_tutor({tA})::text$q$, '1');
SELECT pg_temp.expect('pg', '(7) і це групова ставка, 180', $q$SELECT d.tutor_payout::text FROM lesson_details d WHERE d.lesson_id = {lgA}$q$, '180.00');
DO $$ BEGIN RAISE NOTICE '✅ (7) груповий урок: виплата за окремою груповою ставкою (250, не індивідуальні 400); без ставки — «не задано»; «до виплати», «Виплатити» і витрати періоду рахують її так само, як індивідуальну'; END $$;

-- (8) лінза суперадміна
SELECT pg_temp.expect('sa', '(8) типово — лише власна школа', $q$SELECT count(*)||'/'||sum(student_price) FROM lessons_visible$q$, '2/500.00');
SELECT pg_temp.expect('sa', '(8) типово — людей чужих шкіл немає, самостійні є', $q$SELECT (SELECT count(*) FROM profiles WHERE id IN ({tA},{tB},{sA1},{sB1},{mgrA},{mgrB}))||'/'||(SELECT count(*) FROM profiles WHERE id = {ind})$q$, '0/1');
SELECT pg_temp.must('sa', 'лінза → школа Б', $q$SELECT set_admin_view('hub', {hubB})$q$);
SELECT pg_temp.expect('sa', '(8) обрана школа Б — лише вона', $q$SELECT count(*)||'/'||sum(student_price) FROM lessons_visible WHERE starts_at < now()$q$, '2/700.00');
SELECT pg_temp.expect('sa', '(8) у школі Б суперадмін може допомогти: виплата вже позначена, борги видно', $q$SELECT students_debt::text FROM manager_debts_summary()$q$, '1100.00');
SELECT pg_temp.must('sa', 'суперадмін додає учня в школу Б', $q$INSERT INTO profiles (id, first_name, last_name, is_pending) VALUES ('00000000-0000-4000-8000-000000000077', 'Новий', 'Учень', true)$q$);
SELECT pg_temp.expect('pg', '(8) доданий через лінзу учень потрапив у школу Б', $q$SELECT (SELECT name FROM hubs h WHERE h.id = m.hub_id) FROM hub_members m WHERE m.user_id = '00000000-0000-4000-8000-000000000077'$q$, 'Школа Б');
SELECT pg_temp.must('sa', 'лінза → вся платформа', $q$SELECT set_admin_view('all')$q$);
SELECT pg_temp.expect('sa', '(8) вся платформа — усі три школи', $q$SELECT count(DISTINCT tutor_id)::text FROM lessons_visible$q$, '3');
SELECT pg_temp.expect('sa', '(8) огляд шкіл не залежить від лінзи', $q$SELECT string_agg(h->>'name', ',' ORDER BY h->>'name') FROM jsonb_array_elements(admin_hubs_overview()->'hubs') h WHERE h->>'name' LIKE 'Школа %' OR h->>'name' = 'Моя школа'$q$, 'Моя школа,Школа А,Школа Б');
SELECT pg_temp.must('sa', 'лінза → власна', $q$SELECT set_admin_view('own')$q$);
SELECT pg_temp.denied('mgrA', '(8) менеджер перемикає лінзу', $q$SELECT set_admin_view('all')$q$);
SELECT pg_temp.denied('mgrA', '(8) менеджер читає огляд шкіл', $q$SELECT admin_hubs_overview()::text$q$);
SELECT pg_temp.must('sa', 'суперадмін переносить репетитора між школами', $q$SELECT move_tutor_to_hub({tB}, {hubA})$q$);
SELECT pg_temp.expect('pg', '(8) перенесений репетитор — у школі А і лише в ній', $q$SELECT (SELECT name FROM hubs h WHERE h.id = s.hub_id)||'/'||(SELECT string_agg(h.name, ',') FROM hub_members m JOIN hubs h ON h.id = m.hub_id WHERE m.user_id = {tB}) FROM tutor_workspace_settings s WHERE s.tutor_id = {tB}$q$, 'Школа А/Школа А');
SELECT pg_temp.denied('sa', '(8) репетиторку з власними учнями в школу мовчки не перенести', $q$SELECT move_tutor_to_hub({ind}, {hubA})$q$, $q$SELECT independent_workspace::text FROM tutor_workspace_settings WHERE tutor_id = {ind}$q$, 'true');
DO $$ BEGIN RAISE NOTICE '✅ (8) суперадмін: типово власна школа · обрана школа · вся платформа; доданий через лінзу учень — у тій школі; менеджер лінзи не має'; END $$;

-- (9) самостійну репетиторку з власними учнями мовчки менеджером не зробити
SELECT pg_temp.denied('sa', '(9) школа на людину з власними учнями', $q$SELECT create_hub('Школа Ірини', {ind})$q$, $q$SELECT role::text FROM user_roles WHERE user_id = {ind}$q$, 'tutor');
DO $$ BEGIN RAISE NOTICE '✅ (9) людину, що вже веде власних учнів, створення школи не перетворює на менеджера мовчки'; END $$;

-- (10) школа запрошує учня, який УЖЕ має акаунт — лише зі згодою самої людини (20261111170000)
SELECT pg_temp.signup('sFree', 'free@fam.test', 'Вільна', 'Учениця', 'student');
SELECT pg_temp.denied('tA', '(10) репетитор школи запрошує в школу', $q$SELECT hub_invite_existing_student('free@fam.test')$q$);
SELECT pg_temp.denied('ind', '(10) самостійна репетиторка запрошує в школу', $q$SELECT hub_invite_existing_student('free@fam.test')$q$);
SELECT pg_temp.expect('mgrA', '(10) невідома пошта — чесне «не знайдено»', $q$SELECT hub_invite_existing_student('nobody@nowhere.test')$q$, 'not_found');
SELECT pg_temp.expect('mgrA', '(10) репетиторку як учня не запросити', $q$SELECT hub_invite_existing_student('ind@tutor.test')$q$, 'not_student');
SELECT pg_temp.expect('mgrA', '(10) менеджер А запрошує учня з акаунтом', $q$SELECT hub_invite_existing_student('free@fam.test')$q$, 'sent');
SELECT pg_temp.expect('mgrA', '(10) до згоди менеджер не бачить ані профілю, ані контактів', $q$SELECT (SELECT count(*) FROM profiles WHERE id = {sFree})||'/'||(SELECT count(*) FROM profile_contacts WHERE user_id = {sFree})$q$, '0/0');
SELECT pg_temp.expect('sFree', '(10) людина бачить запрошення і сповіщення', $q$SELECT (SELECT string_agg(hub_name, ',') FROM my_hub_invites())||'/'||(SELECT count(*) FROM notifications WHERE user_id = {sFree} AND type LIKE 'hub_invite_%')$q$, 'Школа А/1');
SELECT pg_temp.denied('mgrB', '(10) таблицю запрошень напряму не читає ніхто', $q$SELECT count(*)::text FROM hub_join_invites$q$);
SELECT pg_temp.expect('sB1', '(10) інший учень чужого запрошення не бачить і не приймає', $q$SELECT (SELECT count(*) FROM my_hub_invites())||'/'||resolve_hub_invite((SELECT i.id FROM my_hub_invites() i LIMIT 1), true)$q$, '0/not_found');
SELECT pg_temp.expect('sFree', '(10) людина приймає', $q$SELECT resolve_hub_invite((SELECT id FROM my_hub_invites() LIMIT 1), true)$q$, 'accepted');
SELECT pg_temp.expect('mgrA', '(10) після згоди — учень школи А: профіль і контакт видно', $q$SELECT (SELECT count(*) FROM profiles WHERE id = {sFree})||'/'||(SELECT count(*) FROM profile_contacts WHERE user_id = {sFree})$q$, '1/1');
SELECT pg_temp.expect('mgrB', '(10) школа Б цієї людини не бачить', $q$SELECT (SELECT count(*) FROM profiles WHERE id = {sFree})::text$q$, '0');
SELECT pg_temp.expect('mgrA', '(10) повторне запрошення — «вже у школі»', $q$SELECT hub_invite_existing_student('free@fam.test')$q$, 'already_member');
SELECT pg_temp.must('mgrA', '(10) і їй можна призначити репетитора школи', $q$INSERT INTO student_rates (tutor_id, student_id, subject, price_per_lesson, currency) VALUES ({tA}, {sFree}, 'Англійська', 600, 'UAH') RETURNING id$q$);
DO $$ BEGIN RAISE NOTICE '✅ (10) учень з акаунтом потрапляє у школу лише за власною згодою; до згоди школа не бачить про нього нічого'; END $$;

-- (11) публічна сторінка школи (20261111190000): вимкнена, доки менеджер не ввімкне; показує лише
-- назву, опис і предмети; заявка від аноніма лягає ЛИШЕ цій школі; стелі живуть у базі
SELECT pg_temp.expect('anon', '(11) сторінки школи немає, доки менеджер її не ввімкнув', $q$SELECT coalesce(hub_public_page('shkola-a')::text, 'немає')$q$, 'немає');
SELECT pg_temp.denied('tA', '(11) репетитор школи вмикає сторінку школи', $q$SELECT set_hub_public_page(true, 'x')$q$);
SELECT pg_temp.denied('ind', '(11) самостійна вмикає сторінку школи', $q$SELECT set_hub_public_page(true, 'x')$q$);
SELECT pg_temp.must('mgrA', '(11) менеджер А вмикає сторінку своєї школи', $q$SELECT set_hub_public_page(true, 'Мови для дітей. Пишіть http://spam.io/x нам')$q$);
SELECT pg_temp.must('pg', '(11) адреса сторінки для перевірок', $q$UPDATE hubs SET public_slug = 'shkola-a' WHERE id = {hubA}$q$);
SELECT pg_temp.expect('anon', '(11) анонім бачить назву, опис без посилань і предмети — і більше нічого',
  $q$SELECT (p->>'name')||' | '||(p->>'about')||' | '||(SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p) k) FROM (SELECT hub_public_page('shkola-a') p) x$q$,
  'Школа А | Мови для дітей. Пишіть нам | about,name,subjects');
SELECT pg_temp.expect('anon', '(11) у предметах є предмет репетитора школи', $q$SELECT (hub_public_page('shkola-a')->'subjects' ? 'Англійська')::text$q$, 'true');
SELECT pg_temp.expect('anon', '(11) заявка без контакту не приймається', $q$SELECT hub_public_lead('shkola-a', 'Мама Олі', 'напишіть мені', 'Англійська', NULL)$q$, 'invalid');
SELECT pg_temp.expect('anon', '(11) заявка до вимкненої/невідомої школи', $q$SELECT hub_public_lead('nema-takoi', 'Мама Олі', '+380501112233', NULL, NULL)$q$, 'closed');
SELECT pg_temp.expect('anon', '(11) анонім залишає заявку', $q$SELECT hub_public_lead('shkola-a', 'Мама Олі www.spam.io', '+380501112233', 'Англійська', 'Дитині 9 років')$q$, 'ok');
SELECT pg_temp.denied('anon', '(11) анонім читає таблицю заявок', $q$SELECT count(*)::text FROM hub_leads$q$);
SELECT pg_temp.denied('mgrA', '(11) і менеджер напряму теж — лише через функцію', $q$SELECT count(*)::text FROM hub_leads$q$);
SELECT pg_temp.expect('mgrA', '(11) менеджер А бачить заявку: імʼя без посилання, контакт, предмет',
  $q$SELECT (l->>'name')||' | '||(l->>'contact')||' | '||(l->>'subject') FROM (SELECT my_hub_public_page()->'leads'->0 l) x$q$, 'Мама Олі | +380501112233 | Англійська');
SELECT pg_temp.expect('mgrA', '(11) менеджеру А прийшло сповіщення', $q$SELECT count(*)::text FROM notifications WHERE user_id = {mgrA} AND type LIKE 'hub_lead_%'$q$, '1');
SELECT pg_temp.expect('mgrB', '(11) менеджер Б чужих заявок не бачить і сповіщення не отримав',
  $q$SELECT jsonb_array_length(my_hub_public_page()->'leads')||'/'||(SELECT count(*) FROM notifications WHERE user_id = {mgrB} AND type LIKE 'hub_lead_%')$q$, '0/0');
SELECT pg_temp.expect('mgrB', '(11) менеджер Б не закриває чужу заявку', $q$SELECT resolve_hub_lead((SELECT (my_hub_public_page()->'leads'->0->>'id')::uuid), true)::text$q$, 'false');
SELECT pg_temp.expect('tA', '(11) репетитор школи заявок не бачить', $q$SELECT coalesce(my_hub_public_page()::text, 'немає')$q$, 'немає');
-- стеля з однієї адреси: 5 на годину (одна вже була)
SELECT pg_temp.run('anon', $q$SELECT hub_public_lead('shkola-a', 'Ще одна', '+380501112233', NULL, NULL)$q$) FROM generate_series(1, 4);
SELECT pg_temp.expect('anon', '(11) шоста заявка за годину з однієї адреси — стеля', $q$SELECT hub_public_lead('shkola-a', 'Шоста', '+380501112233', NULL, NULL)$q$, 'limit');
SELECT pg_temp.must('mgrA', '(11) менеджер вимикає сторінку', $q$SELECT set_hub_public_page(false, NULL)$q$);
SELECT pg_temp.expect('anon', '(11) вимкнена сторінка зникає одразу', $q$SELECT coalesce(hub_public_page('shkola-a')::text, 'немає')$q$, 'немає');
DO $$ BEGIN RAISE NOTICE '✅ (11) сторінка школи: лише з волі менеджера, без імен і цін, заявки — тільки своїй школі, стелі в базі'; END $$;

ROLLBACK;
