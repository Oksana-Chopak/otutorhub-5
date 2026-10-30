-- Сценарій: власниці/менеджерам у Telegram — запит на репетитора · заявка на Pro ·
-- відгук (26.10, міграція 20261026120000_owner_alerts).
--
-- Що доводимо:
--   (1) запит хабового учня → сповіщення менеджеру ЙОГО школи, адміну — ні;
--       тип несе id заявки; текст — імʼя, предмет, рівень, контакти;
--   (2) клієнтський fallback (notify_managers з тим самим типом) дубля не створює
--       і не перебиває український заголовок тригера;
--   (3) другий запит того ж учня того ж дня — ОКРЕМЕ сповіщення (раніше
--       `create_notification` ковтав його за дедупом (user, type) на 24 год);
--   (4) учень без школи → платформний адмін;
--   (5) анкета лендінгу (service role, без акаунта) → адмін, з контактами ліда;
--   (6) заявка на Pro → адмін; (7) відгук із застосунку, анонімне звернення з
--       лендінгу → адмін; власний відгук адміна — нікому;
--   (8) стеля 5/год на автора: заявки зберігаються, сповіщень — не більше 5;
--   (9) помічники не викликати з браузера.
-- ROLLBACK у кінці — база чиста.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  hubid uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  hubstud uuid := gen_random_uuid();
  indstud uuid := gen_random_uuid();
  indtutor uuid := gen_random_uuid();
  req uuid; n int; r record; i int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (mgr,      'mgr72@test.local', now(), '{"first_name":"Мен","last_name":"Еджер","role":"tutor"}'),
    (adm,      'adm72@test.local', now(), '{"first_name":"Оксана","last_name":"Власниця","role":"tutor"}'),
    (hubstud,  'hs72@test.local',  now(), '{"first_name":"Хабовий","last_name":"Учень","role":"student","phone":"+380501111111"}'),
    (indstud,  'is72@test.local',  now(), '{"first_name":"Вільна","last_name":"Учениця","role":"student"}'),
    (indtutor, 'it72@test.local',  now(), '{"first_name":"Незалежний","last_name":"Репетитор","role":"tutor","independent_workspace":true}');
  INSERT INTO public.hubs (id, name, created_by) VALUES (hubid, 'Школа 72', mgr);
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (hubid, mgr);
  DELETE FROM public.user_roles WHERE user_id = mgr AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (mgr, 'manager') ON CONFLICT DO NOTHING;
  INSERT INTO public.platform_admins (user_id) VALUES (adm) ON CONFLICT DO NOTHING;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (hubid, hubstud) ON CONFLICT DO NOTHING;
  UPDATE public.tutor_workspace_settings
     SET independent_workspace = true, subscription_status = 'trial', trial_until = now() + interval '30 days'
   WHERE tutor_id = indtutor;
  DELETE FROM public.notifications WHERE user_id IN (mgr, adm);

  -- ── (1) хабовий учень → менеджер школи ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hubstud, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  req := gen_random_uuid();   -- як клієнт: id народжується до вставки
  INSERT INTO public.tutor_referral_requests (id, student_id, subject, preferred_level, message, source)
    VALUES (req, hubstud, 'Математика', 'ЗНО', 'Хочу підтягнути геометрію', 'self_service');
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = mgr AND type = 'tutor_request_' || req::text;
  IF n <> 1 THEN RAISE EXCEPTION '(1) менеджер школи не отримав сповіщення про запит свого учня (%)', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = adm AND type = 'tutor_request_' || req::text;
  IF n <> 0 THEN RAISE EXCEPTION '(1) ДІРКА: запит учня ШКОЛИ пішов платформному адміну'; END IF;
  SELECT * INTO r FROM public.notifications WHERE user_id = mgr AND type = 'tutor_request_' || req::text;
  IF r.title NOT LIKE '🙋 Хабовий Учень шукає репетитора · Математика' THEN RAISE EXCEPTION '(1) заголовок: %', r.title; END IF;
  IF r.body NOT LIKE '%ЗНО%' OR r.body NOT LIKE '%геометрію%' OR r.body NOT LIKE '%+380501111111%' OR r.body NOT LIKE '%hs72@test.local%' THEN
    RAISE EXCEPTION '(1) тіло без рівня/повідомлення/контактів: %', r.body;
  END IF;
  IF r.link <> '/referrals' THEN RAISE EXCEPTION '(1) посилання: %', r.link; END IF;
  RAISE NOTICE '✅ (1) запит учня школи → її менеджер; тип з id, текст з імʼям, предметом, рівнем і контактами';

  -- ── (2) клієнтський fallback з тим самим типом — без дубля ──────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hubstud, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.notify_managers('tutor_request_' || req::text, 'hs72 is looking for a tutor', NULL, '/referrals');
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = mgr AND type = 'tutor_request_' || req::text;
  IF n <> 1 THEN RAISE EXCEPTION '(2) після клієнтського fallback сповіщень: % (дубль)', n; END IF;
  IF (SELECT title FROM public.notifications WHERE user_id = mgr AND type = 'tutor_request_' || req::text) NOT LIKE '🙋 %' THEN
    RAISE EXCEPTION '(2) fallback перебив заголовок тригера';
  END IF;
  RAISE NOTICE '✅ (2) запасний шлях із клієнта дедуплікується з тригером';

  -- ── (3) другий запит за добу — окреме сповіщення ────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hubstud, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.tutor_referral_requests (student_id, subject, source) VALUES (hubstud, 'Фізика', 'self_service');
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = mgr AND type LIKE 'tutor_request_%';
  IF n <> 2 THEN RAISE EXCEPTION '(3) другий запит за добу не став окремим сповіщенням (%)', n; END IF;
  RAISE NOTICE '✅ (3) два запити за день — два сповіщення (раніше другий ковтався)';

  -- ── (4) учень без школи → адмін ─────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indstud, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.tutor_referral_requests (student_id, subject, source) VALUES (indstud, 'Англійська', 'self_service');
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = adm AND type LIKE 'tutor_request_%';
  IF n <> 1 THEN RAISE EXCEPTION '(4) адмін не отримав запит учня без школи (%)', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = mgr AND type LIKE 'tutor_request_%';
  IF n <> 2 THEN RAISE EXCEPTION '(4) ДІРКА: запит чужого учня пішов менеджеру школи'; END IF;
  RAISE NOTICE '✅ (4) учень без школи → платформний адмін, менеджер школи не чує';

  -- ── (5) анкета лендінгу (service role, без акаунта) ─────────────────────────
  PERFORM set_config('role', 'service_role', true);
  req := gen_random_uuid();
  INSERT INTO public.tutor_referral_requests (id, student_id, subject, source, lead_name, lead_email, lead_phone, message, preferred_level)
    VALUES (req, NULL, 'Хімія', 'landing_quiz', 'Марія Лід', 'maria@lead.test', '+380670000000', 'Готуюсь до НМТ', 'НМТ');
  PERFORM set_config('role', 'postgres', true);
  SELECT * INTO r FROM public.notifications WHERE user_id = adm AND type = 'tutor_request_' || req::text;
  IF r.id IS NULL THEN RAISE EXCEPTION '(5) анкета лендінгу не дала сповіщення адміну'; END IF;
  IF r.title NOT LIKE '🙋 Марія Лід шукає репетитора · Хімія' THEN RAISE EXCEPTION '(5) заголовок: %', r.title; END IF;
  IF r.body NOT LIKE 'з лендінгу%' OR r.body NOT LIKE '%+380670000000%' OR r.body NOT LIKE '%maria@lead.test%' THEN
    RAISE EXCEPTION '(5) тіло без позначки лендінгу чи контактів ліда: %', r.body;
  END IF;
  RAISE NOTICE '✅ (5) анкета з лендінгу: імʼя, предмет, «з лендінгу», телефон і пошта ліда';

  -- ── (6) заявка на Pro ───────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indtutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  req := gen_random_uuid();
  INSERT INTO public.subscription_requests (id, tutor_id, plan, price, message) VALUES (req, indtutor, 'pro_monthly', 249, 'Оплачу карткою');
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT * INTO r FROM public.notifications WHERE user_id = adm AND type = 'pro_request_' || req::text;
  IF r.id IS NULL THEN RAISE EXCEPTION '(6) заявка на Pro не дала сповіщення адміну'; END IF;
  IF r.title NOT LIKE '👑 Незалежний Репетитор хоче підписку%' OR r.body NOT LIKE '%249 ₴%' OR r.link <> '/subscription-requests' THEN
    RAISE EXCEPTION '(6) текст/посилання: % | % | %', r.title, r.body, r.link;
  END IF;
  RAISE NOTICE '✅ (6) заявка на Pro → адмін, із сумою та посиланням на заявки';

  -- ── (7) відгуки ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indtutor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO public.feedback_submissions (user_id, category, message, rating, page_url) VALUES (indtutor, 'bug', 'Кнопка не тисне на айфоні', 2, '/schedule') RETURNING id INTO req;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT * INTO r FROM public.notifications WHERE user_id = adm AND type = 'feedback_new_' || req::text;
  IF r.id IS NULL THEN RAISE EXCEPTION '(7) відгук із застосунку не дав сповіщення'; END IF;
  IF r.title NOT LIKE '🐞 Баг від Незалежний Репетитор · 2★' OR r.body NOT LIKE 'Кнопка не тисне%' OR r.link <> '/feedback-inbox' THEN
    RAISE EXCEPTION '(7) текст: % | % | %', r.title, r.body, r.link;
  END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = adm AND type LIKE 'feedback_new_%';
  INSERT INTO public.feedback_submissions (user_id, category, message) VALUES (adm, 'idea', 'тест адміна');
  IF (SELECT count(*) FROM public.notifications WHERE user_id = adm AND type LIKE 'feedback_new_%') <> n THEN
    RAISE EXCEPTION '(7) адмін отримав сповіщення про власний відгук';
  END IF;
  -- анонімне звернення з лендінгу (як submit_landing_feedback: user_id NULL, category landing)
  INSERT INTO public.feedback_submissions (user_id, category, message, contact, page_url) VALUES (NULL, 'landing', 'Скільки коштує для школи?', 'ivan@x.test', '/') RETURNING id INTO req;
  SELECT * INTO r FROM public.notifications WHERE user_id = adm AND type = 'feedback_new_' || req::text;
  IF r.id IS NULL THEN RAISE EXCEPTION '(7) анонімне звернення з лендінгу не дало сповіщення'; END IF;
  IF r.title <> '✉️ Звернення з лендінгу' OR r.body NOT LIKE '%ivan@x.test%' THEN RAISE EXCEPTION '(7) лендінг: % | %', r.title, r.body; END IF;
  RAISE NOTICE '✅ (7) відгук → адмін з категорією, оцінкою й сторінкою; власний — ні; анонімний з лендінгу — з контактом';

  -- ── (8) стеля на автора ─────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = adm AND type LIKE 'tutor_request_%';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', indstud, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOR i IN 1..7 LOOP
    INSERT INTO public.tutor_referral_requests (student_id, subject, source) VALUES (indstud, 'Спам ' || i, 'self_service');
  END LOOP;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (SELECT count(*) FROM public.notifications WHERE user_id = adm AND type LIKE 'tutor_request_%') - n <> 4 THEN
    RAISE EXCEPTION '(8) стеля 5/год на автора не тримає: нових сповіщень %', (SELECT count(*) FROM public.notifications WHERE user_id = adm AND type LIKE 'tutor_request_%') - n;
  END IF;
  SELECT count(*) INTO n FROM public.tutor_referral_requests WHERE student_id = indstud;
  IF n <> 8 THEN RAISE EXCEPTION '(8) ДІРКА: стеля сповіщень зʼїла самі заявки (% з 8)', n; END IF;
  RAISE NOTICE '✅ (8) понад 5 заявок на годину від одного автора: заявки всі є, сповіщень 5';

  -- ── (9) помічники закриті від браузера ──────────────────────────────────────
  IF has_function_privilege('authenticated', 'public.owner_alert(uuid, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.owner_alert(uuid, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.owner_alert_recipients(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.owner_alert_contact(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '(9) ДІРКА: помічники сповіщень доступні з браузера (чужі контакти / довільні сповіщення адміну)';
  END IF;
  RAISE NOTICE '✅ (9) owner_alert* — лише з тригерів';
END $$;

ROLLBACK;
