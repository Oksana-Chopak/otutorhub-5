-- Сценарій: самолікування виплат (рішення 13.09, «пропала ставка у Петра Городного»).
-- Кодифікує ручний доказ аудиторки з 13.09: виплата на хабовому уроці НЕ лишається
-- NULL/0, поки в репетитора є ставка; ставка береться по предмету без регістру й
-- пробілів, далі — з профілю; незалежний урок і репетитор без ставки — без вигадок.
-- Падає RAISE EXCEPTION, якщо тригер `trg_lesson_details_autofill` перестане так
-- поводитись. Усе всередині однієї транзакції з ROLLBACK — база лишається чистою.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  hub_id uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid();
  tutor uuid := gen_random_uuid();
  stud uuid := gen_random_uuid();
  ind uuid := gen_random_uuid();
  ind_stud uuid := gen_random_uuid();
  l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  d record;
BEGIN
  -- Люди — через СПРАВЖНІЙ шлях реєстрації: INSERT в auth.users запускає
  -- handle_new_user (профіль, контакти, роль, деталі, workspace як у проді)
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr,      'mgr@test.local',      '{"first_name":"Менеджер","last_name":"Школи","role":"tutor"}'),
    (tutor,    'tutor@test.local',    '{"first_name":"Петро","last_name":"Городний","role":"tutor"}'),
    (stud,     'stud@test.local',     '{"first_name":"Учень","last_name":"Школи","role":"student"}'),
    (ind,      'ind@test.local',      '{"first_name":"Самостійна","last_name":"Репетиторка","role":"tutor","independent_workspace":true}'),
    (ind_stud, 'ind_stud@test.local', '{"first_name":"Її","last_name":"Учень","role":"student"}');
  -- Школа: сутність + менеджер (роль manager видає лише суперадмін/create_hub — тут ми service role)
  INSERT INTO public.hubs (id, name, created_by) VALUES (hub_id, 'Тестова школа', mgr);
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hub_id, mgr);
  INSERT INTO public.user_roles (user_id, role) VALUES (mgr, 'manager') ON CONFLICT DO NOTHING;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, hub_id) VALUES (tutor, false, hub_id)
    ON CONFLICT (tutor_id) DO UPDATE SET independent_workspace = false, hub_id = EXCLUDED.hub_id;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace) VALUES (ind, true)
    ON CONFLICT (tutor_id) DO UPDATE SET independent_workspace = true;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hub_id, tutor), (hub_id, stud) ON CONFLICT DO NOTHING;

  -- Ставки: предметна 300 (Математика), профільна 250; ціна учня 600
  UPDATE public.tutor_details SET subjects = ARRAY['Математика'], rate_per_lesson = 250 WHERE user_id = tutor;
  IF NOT FOUND THEN RAISE EXCEPTION 'handle_new_user не створив tutor_details'; END IF;
  INSERT INTO public.tutor_subject_rates (tutor_id, subject, rate_per_lesson) VALUES (tutor, 'Математика', 300);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, source) VALUES (tutor, stud, 'Математика', 600, 'hub');
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, source) VALUES (ind, ind_stud, 'Англійська', 400, 'independent');

  -- 1. Хабовий урок, предмет у іншому регістрі й з пробілом → 600 / 300
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source)
    VALUES (tutor, stud, ' математика ', now() - interval '1 day', 60, mgr, 'hub') RETURNING id INTO l1;
  SELECT * INTO d FROM public.lesson_details WHERE lesson_id = l1;
  IF d IS NULL THEN RAISE EXCEPTION 'trg_lessons_ensure_details не створив рядок деталей'; END IF;
  IF COALESCE(d.student_price, 0) <> 600 THEN RAISE EXCEPTION 'ціна учня: очікували 600, є %', d.student_price; END IF;
  IF COALESCE(d.tutor_payout, 0) <> 300 THEN RAISE EXCEPTION 'виплата по предмету: очікували 300, є %', d.tutor_payout; END IF;

  -- 2. Хтось стер виплату в 0 → тригер на UPDATE OF tutor_payout лікує назад
  UPDATE public.lesson_details SET tutor_payout = 0 WHERE lesson_id = l1;
  SELECT tutor_payout INTO d FROM public.lesson_details WHERE lesson_id = l1;
  IF COALESCE(d.tutor_payout, 0) <> 300 THEN RAISE EXCEPTION 'самолікування після UPDATE 0: очікували 300, є %', d.tutor_payout; END IF;

  -- 3. Свідома сума лишається (менеджер поставив 280 вручну)
  UPDATE public.lesson_details SET tutor_payout = 280 WHERE lesson_id = l1;
  SELECT tutor_payout INTO d FROM public.lesson_details WHERE lesson_id = l1;
  IF d.tutor_payout <> 280 THEN RAISE EXCEPTION 'свідома сума перезаписана: очікували 280, є %', d.tutor_payout; END IF;

  -- 4. Предмет без власної ставки → профільна 250
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source)
    VALUES (tutor, stud, 'Фізика', now() - interval '2 day', 60, mgr, 'hub') RETURNING id INTO l2;
  SELECT tutor_payout INTO d FROM public.lesson_details WHERE lesson_id = l2;
  IF COALESCE(d.tutor_payout, 0) <> 250 THEN RAISE EXCEPTION 'фолбек на профільну ставку: очікували 250, є %', d.tutor_payout; END IF;

  -- 5. Незалежний урок: виплата НЕ вигадується (у незалежного немає «виплати від школи»)
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source)
    VALUES (ind, ind_stud, 'Англійська', now() - interval '1 day', 60, ind, 'independent') RETURNING id INTO l3;
  SELECT * INTO d FROM public.lesson_details WHERE lesson_id = l3;
  IF COALESCE(d.student_price, 0) <> 400 THEN RAISE EXCEPTION 'ціна незалежного учня: очікували 400, є %', d.student_price; END IF;
  IF COALESCE(d.tutor_payout, 0) <> 0 THEN RAISE EXCEPTION 'незалежному уроку вигадано виплату %', d.tutor_payout; END IF;

  -- 6. Репетитор без жодної ставки → без вигадок (0/NULL лишається, інтерфейс каже «не задано»)
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = tutor;
  UPDATE public.tutor_details SET rate_per_lesson = 0 WHERE user_id = tutor;  -- колонка NOT NULL: «немає ставки» = 0
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source)
    VALUES (tutor, stud, 'Хімія', now() - interval '3 day', 60, mgr, 'hub') RETURNING id INTO l4;
  SELECT tutor_payout INTO d FROM public.lesson_details WHERE lesson_id = l4;
  IF COALESCE(d.tutor_payout, 0) <> 0 THEN RAISE EXCEPTION 'репетитору без ставки вигадано виплату %', d.tutor_payout; END IF;

  RAISE NOTICE '✅ самолікування виплат: предмет 300 · лікування після 0 · свідома 280 лишається · профіль 250 · незалежний без вигадок · без ставки без вигадок';
END $$;

ROLLBACK;
