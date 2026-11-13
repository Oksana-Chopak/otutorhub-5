-- Сценарій: репетитор школи зберігає свої предмети так, як це робить застосунок
-- («вставити або оновити») — і ставка, яку поставив менеджер, лишається на місці
-- (13.11: захист ставки ламав будь-яке збереження предметів).
--   (1) рядка ще немає → предмети зберігаються, ставка 0 («не задано»);
--   (2) рядок є, менеджер поставив ставку 300 → репетитор міняє предмети, ставка 300;
--   (3) підняти собі ставку тим самим запитом — не можна.
BEGIN;
SET LOCAL client_min_messages = notice;
DO $$
DECLARE
  mgr uuid := gen_random_uuid(); hub uuid := gen_random_uuid(); hubid uuid;
  r numeric; subj text[]; caught text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr, 'm78@replay.local', '{"first_name":"Мен","last_name":"Еджер","role":"tutor"}'),
    (hub, 'h78@replay.local', '{"first_name":"Хаб","last_name":"Репетитор","role":"tutor"}');
  PERFORM set_config('app.allow_manager_role', '1', true);
  UPDATE public.user_roles SET role = 'manager'::app_role WHERE user_id = mgr;
  INSERT INTO public.hubs (name) VALUES ('Школа 78') RETURNING id INTO hubid;
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hubid, mgr) ON CONFLICT DO NOTHING;
  PERFORM set_config('app.allow_manager_role', NULL, true);
  UPDATE public.tutor_workspace_settings SET hub_id = hubid, independent_workspace = false WHERE tutor_id = hub;
  DELETE FROM public.tutor_details WHERE user_id = hub;

  -- (1) рядка немає
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hub, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.tutor_details (user_id, subjects) VALUES (hub, ARRAY['Іспанська мова'])
    ON CONFLICT (user_id) DO UPDATE SET subjects = EXCLUDED.subjects;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT rate_per_lesson, subjects INTO r, subj FROM public.tutor_details WHERE user_id = hub;
  IF subj IS DISTINCT FROM ARRAY['Іспанська мова'] OR COALESCE(r, -1) <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (1): предмети %, ставка %', subj, r; END IF;
  RAISE NOTICE '✅ (1) репетитор школи зберіг предмети з нуля';

  -- менеджер ставить ставку
  UPDATE public.tutor_details SET rate_per_lesson = 300 WHERE user_id = hub;

  -- (2) рядок є
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hub, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.tutor_details (user_id, subjects) VALUES (hub, ARRAY['Іспанська мова', 'Англійська мова'])
    ON CONFLICT (user_id) DO UPDATE SET subjects = EXCLUDED.subjects;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT rate_per_lesson, subjects INTO r, subj FROM public.tutor_details WHERE user_id = hub;
  IF array_length(subj, 1) <> 2 OR r <> 300 THEN RAISE EXCEPTION 'ПРОВАЛ (2): предмети %, ставка % (мала лишитись 300)', subj, r; END IF;
  RAISE NOTICE '✅ (2) предмети змінено, ставка менеджера на місці';

  -- (3) ставку собі — ні
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hub, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    INSERT INTO public.tutor_details (user_id, subjects, rate_per_lesson) VALUES (hub, ARRAY['Іспанська мова'], 900)
      ON CONFLICT (user_id) DO UPDATE SET subjects = EXCLUDED.subjects, rate_per_lesson = 900;
    caught := 'пройшло';
  EXCEPTION WHEN insufficient_privilege THEN caught := 'відмова'; END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT rate_per_lesson INTO r FROM public.tutor_details WHERE user_id = hub;
  IF caught <> 'відмова' OR r <> 300 THEN RAISE EXCEPTION 'ПРОВАЛ (3): репетитор школи змінив собі ставку (%, %)', caught, r; END IF;
  RAISE NOTICE '✅ (3) підняти собі ставку не можна';
END $$;
ROLLBACK;
