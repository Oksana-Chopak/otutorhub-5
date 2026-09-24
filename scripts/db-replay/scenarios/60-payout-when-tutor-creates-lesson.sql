-- Сценарій: виплата на уроці, який створив САМ хабовий репетитор (24.09, «Самолюк —
-- ставку не задано»).
--
-- Живі дані 24.09 (Марина Самолюк, ставка 350 з травня): уроки, що їх поставив
-- менеджер, мають виплату 350; уроки, які репетиторка поставила САМА (14.09,
-- 18.09, 22.09), — tutor_payout NULL і tutor_payout_status NULL, хоча обидва
-- тригери самолікування (13.09) увімкнені й ціна учня 600 підставилась.
--
-- Причина: на lesson_details два BEFORE INSERT тригери, і Postgres виконує їх
-- ЗА АБЕТКОЮ імені: `trg_lesson_details_autofill` (ставка → 350) біжить ПЕРШИМ,
-- а `trg_protect_lesson_details_payout_insert` (20.06: не-менеджер не може
-- вписати виплату сам → NEW.tutor_payout := NULL, NEW.tutor_payout_status := NULL)
-- біжить ДРУГИМ і стирає щойно підставлену ставку. Коментар у захисті каже
-- «autofill потім заповнить» — але «потім» не настає ніколи. Сценарій 10 цього
-- не бачив, бо створював уроки як postgres (auth.uid() = NULL → захист мовчить).
--
-- Тут уроки створюються ТАК, як у житті: під ролью authenticated з JWT репетитора
-- і з JWT менеджера. Очікування в обох випадках однакове: виплата = ставка,
-- статус = 'unpaid'. Падає RAISE EXCEPTION. ROLLBACK у кінці — база чиста.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  hub_id uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid();
  tutor uuid := gen_random_uuid();
  stud uuid := gen_random_uuid();
  l_tutor uuid; l_mgr uuid;
  d record;
  n integer;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr,   'mgr50@test.local',   '{"first_name":"Менеджер","last_name":"Школи","role":"tutor"}'),
    (tutor, 'tutor50@test.local', '{"first_name":"Марина","last_name":"Самолюк","role":"tutor"}'),
    (stud,  'stud50@test.local',  '{"first_name":"Учень","last_name":"Марини","role":"student"}');
  INSERT INTO public.hubs (id, name, created_by) VALUES (hub_id, 'Школа сценарію 50', mgr);
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hub_id, mgr);
  -- Роль менеджера — як це робить create_hub: одна роль на людину (UNIQUE user_id),
  -- тож «ON CONFLICT DO NOTHING» мовчки лишив би роль tutor від реєстрації.
  DELETE FROM public.user_roles WHERE user_id = mgr AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (mgr, 'manager') ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = mgr AND role = 'manager'::app_role) THEN
    RAISE EXCEPTION 'сетап: менеджер не отримав роль manager';
  END IF;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, hub_id) VALUES (tutor, false, hub_id)
    ON CONFLICT (tutor_id) DO UPDATE SET independent_workspace = false, hub_id = EXCLUDED.hub_id;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hub_id, tutor), (hub_id, stud) ON CONFLICT DO NOTHING;

  -- Ставка як у Марини: один предмет, 350 і в таблиці ставок, і в профілі; ціна учня 600
  UPDATE public.tutor_details SET subjects = ARRAY['Англійська мова'], rate_per_lesson = 350 WHERE user_id = tutor;
  IF NOT FOUND THEN RAISE EXCEPTION 'handle_new_user не створив tutor_details'; END IF;
  INSERT INTO public.tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES (tutor, 'Англійська мова', 350);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, source) VALUES (tutor, stud, 'Англійська мова', 600, 'hub');

  -- 1. Урок ставить САМА репетиторка (як QuickLessonDialog variant="hub": лише lessons, деталі — тригер)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
    VALUES (tutor, stud, 'Англійська мова', now() + interval '2 hour', 60, tutor, 'hub', 'scheduled') RETURNING id INTO l_tutor;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO d FROM public.lesson_details WHERE lesson_id = l_tutor;
  IF d IS NULL THEN RAISE EXCEPTION 'урок репетиторки: trg_lessons_ensure_details не створив рядок деталей'; END IF;
  IF COALESCE(d.student_price, 0) <> 600 THEN RAISE EXCEPTION 'урок репетиторки: ціна учня — очікували 600, є %', d.student_price; END IF;
  IF COALESCE(d.tutor_payout, 0) <> 350 THEN
    RAISE EXCEPTION 'урок, створений САМИМ репетитором: виплата — очікували 350, є % (статус %). Це і є «Самолюк — ставку не задано»: захист payout_insert біжить ПІСЛЯ autofill і стирає ставку', d.tutor_payout, d.tutor_payout_status;
  END IF;
  IF COALESCE(d.tutor_payout_status, '') <> 'unpaid' THEN RAISE EXCEPTION 'урок репетиторки: статус виплати — очікували unpaid, є %', d.tutor_payout_status; END IF;

  -- 2. Той самий урок ставить менеджер — має бути так само 350 / unpaid
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
    VALUES (tutor, stud, 'Англійська мова', now() + interval '1 day', 60, mgr, 'hub', 'scheduled') RETURNING id INTO l_mgr;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO d FROM public.lesson_details WHERE lesson_id = l_mgr;
  IF COALESCE(d.tutor_payout, 0) <> 350 THEN RAISE EXCEPTION 'урок від менеджера: виплата — очікували 350, є %', d.tutor_payout; END IF;
  IF COALESCE(d.tutor_payout_status, '') <> 'unpaid' THEN RAISE EXCEPTION 'урок від менеджера: статус виплати — очікували unpaid, є %', d.tutor_payout_status; END IF;

  -- 3. Захист лишається захистом: репетитор НЕ може вписати довільну виплату сам
  --    (вставка деталей напряму від репетитора заборонена політикою з 01.07 — тож
  --    перевіряємо самою функцією: не-менеджер → виплата стирається до ставки, не до NULL-статусу)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    UPDATE public.lesson_details SET tutor_payout = 9999 WHERE lesson_id = l_tutor;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- заборона оновлення (грант/політика) — теж прийнятна відповідь захисту
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT * INTO d FROM public.lesson_details WHERE lesson_id = l_tutor;
  IF d.tutor_payout = 9999 THEN RAISE EXCEPTION 'репетитор сам вписав виплату 9999 — захист маржі не працює'; END IF;

  -- 4. Порядок BEFORE INSERT тригерів на lesson_details: захист мусить стояти ПЕРЕД autofill
  SELECT count(*) INTO n FROM pg_trigger t1, pg_trigger t2
   WHERE t1.tgrelid = 'public.lesson_details'::regclass AND t2.tgrelid = t1.tgrelid
     AND t1.tgname LIKE '%protect_lesson_details_payout_insert' AND t2.tgname = 'trg_lesson_details_autofill'
     AND t1.tgname < t2.tgname;
  IF n <> 1 THEN RAISE EXCEPTION 'тригер захисту виплати не стоїть перед trg_lesson_details_autofill за абеткою — autofill знову буде стертий'; END IF;

  RAISE NOTICE '✅ виплата на уроці, який створив сам репетитор: 350/unpaid від репетитора · 350/unpaid від менеджера · довільну суму репетитор не впише · порядок тригерів захист → autofill';
END $$;

ROLLBACK;
