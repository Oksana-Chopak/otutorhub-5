-- Сценарій: хабовий репетитор без рядка налаштувань (26.09, звіт робота з проду).
-- Менеджер, який робить репетитора з людини, зареєстрованої УЧНЕМ, виконує UPDATE
-- (у user_roles UNIQUE (user_id) — одна роль на людину), а тригер висів лише на
-- AFTER INSERT → рядок tutor_workspace_settings не створювався ніколи, і «Фінанси»
-- показували «Не вдалося завантажити». Перевіряємо чотири боки:
--   (1) UPDATE ролі учня → репетитор створює рядок із школою менеджера;
--   (2) те саме, коли роль міняє суперадмін (школа береться з членства людини);
--   (3) INSERT ролі менеджером і далі працює (не зламали старий шлях);
--   (4) is_pending_email доступна anon (запрошені завершують реєстрацію).
-- Усе — як PostgREST: від авторизованого користувача, не суперкористувачем.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  mgr uuid := gen_random_uuid();
  pupil uuid := gen_random_uuid();     -- (1) зареєструвався учнем, менеджер робить репетитором
  pupil2 uuid := gen_random_uuid();    -- (2) те саме, але роль міняє суперадмін
  fresh uuid := gen_random_uuid();     -- (3) нова людина, менеджер ВСТАВЛЯЄ роль
  hubid uuid;
  n int;
  ws record;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr,    'm80@replay.local', '{"first_name":"Мен","last_name":"Еджер","role":"tutor"}'),
    (pupil,  'p80@replay.local', '{"first_name":"Був","last_name":"Учнем"}'),
    (pupil2, 'q80@replay.local', '{"first_name":"Теж","last_name":"Учень"}'),
    (fresh,  'f80@replay.local', '{"first_name":"Нова","last_name":"Людина"}');

  -- школа й менеджер (як робить суперадмін через create_hub)
  PERFORM set_config('app.allow_manager_role', '1', true);
  UPDATE public.user_roles SET role = 'manager'::app_role WHERE user_id = mgr;
  INSERT INTO public.hubs (name) VALUES ('Школа 80') RETURNING id INTO hubid;
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hubid, mgr) ON CONFLICT DO NOTHING;
  PERFORM set_config('app.allow_manager_role', NULL, true);
  -- обидві «колишні учениці» — члени школи (так їх і заводить менеджер)
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hubid, pupil), (hubid, pupil2), (hubid, fresh)
  ON CONFLICT DO NOTHING;  -- fresh теж член школи: інакше політика user_roles не дасть менеджеру видати роль
  -- рядок, який міг зʼявитись від handle_new_user, прибираємо: сценарій саме про його відсутність
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id IN (pupil, pupil2, fresh);

  -- (1) МЕНЕДЖЕР міняє роль: INSERT не буде, буде UPDATE
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  UPDATE public.user_roles SET role = 'tutor'::app_role WHERE user_id = pupil;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT * INTO ws FROM public.tutor_workspace_settings WHERE tutor_id = pupil;
  IF ws.tutor_id IS NULL THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): менеджер змінив роль на репетитора, а рядка налаштувань немає — «Фінанси» покажуть помилку';
  END IF;
  IF ws.independent_workspace IS DISTINCT FROM false OR ws.hub_id IS DISTINCT FROM hubid THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): рядок є, але не хабовий (independent=%, hub=%)', ws.independent_workspace, ws.hub_id;
  END IF;
  RAISE NOTICE '✅ (1) UPDATE ролі менеджером → хабовий рядок із школою створено';

  -- (2) роль міняє суперадмін/службовий шлях: школи в контексті немає, беремо з членства
  PERFORM set_config('app.allow_manager_role', '1', true);
  UPDATE public.user_roles SET role = 'tutor'::app_role WHERE user_id = pupil2;
  PERFORM set_config('app.allow_manager_role', NULL, true);
  SELECT * INTO ws FROM public.tutor_workspace_settings WHERE tutor_id = pupil2;
  IF ws.tutor_id IS NULL OR ws.hub_id IS DISTINCT FROM hubid THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): роль змінив не менеджер — школу мусили взяти з членства (hub=%)', ws.hub_id;
  END IF;
  RAISE NOTICE '✅ (2) без контексту менеджера школа взята з членства людини';

  -- (3) старий шлях (INSERT ролі менеджером) не зламався
  DELETE FROM public.user_roles WHERE user_id = fresh;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (fresh, 'tutor'::app_role);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO n FROM public.tutor_workspace_settings WHERE tutor_id = fresh AND hub_id = hubid;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (3): INSERT ролі більше не створює рядок (%)', n; END IF;
  RAISE NOTICE '✅ (3) INSERT ролі менеджером і далі створює рядок';

  -- (4) запрошені завершують реєстрацію: функція доступна анонімному браузеру
  IF NOT has_function_privilege('anon', 'public.is_pending_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): is_pending_email без EXECUTE для anon — запрошений застрягне на підтвердженні';
  END IF;
  PERFORM set_config('role', 'anon', true);
  PERFORM public.is_pending_email('nobody@replay.local');
  RESET role;
  RAISE NOTICE '✅ (4) is_pending_email викликається з анонімного боку';
END $$;

ROLLBACK;
