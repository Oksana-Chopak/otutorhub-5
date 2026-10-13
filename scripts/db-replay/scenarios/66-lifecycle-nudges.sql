-- Сценарій: ланцюжок листів/Telegram і розсилка, яка доходить (13.10, пре-мортем:
-- «зовсім немає ланцюжка, яким би ми онбордили нових, просинали неактивних»).
-- Час у сценарії — параметр `_at` функції `lifecycle_candidates`: журнал пише
-- справжній now(), а «сьогодні» для людини ми рухаємо вперед, як календар.
-- Перевіряємо:
--   (1) новий репетитор у перші 24 години отримує «привітання» — і лише раз;
--   (2) день 1 без учня → «додай учня»; день 3 з учнем без уроку → «постав урок»;
--       день 7 з уроком без оплати → «познач оплату»; кожен крок — один раз;
--   (3) тріал: за 7 днів, за 2 дні, після кінця — з цифрами людини (учні, уроки,
--       борг, нагадано за вас);
--   (4) сплячі: 14 днів без активності → одне повідомлення на цикл сну; нова
--       активність відкриває новий цикл — 7 днів → знову одне;
--   (5) тихі години Києва (20:00–09:00) — нікого не будимо;
--   (6) відписаний від розсилок отримує ЛИШЕ привітання;
--   (7) `tutor_reminder_stats`: два канали одного дня = ОДНЕ нагадування;
--       оплата ПІСЛЯ нагадування = «повернуто після нагадувань»;
--   (8) `get_marketing_recipients`: сегменти за справжніми статусами (active,
--       cancelled, тріал закінчився) і Telegram-чат у відповіді;
--   (9) з браузера (authenticated) кандидати/журнал недоступні — лише службова роль.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  tutor uuid := gen_random_uuid();
  quiet uuid := gen_random_uuid();   -- відписаний від розсилок
  admin uuid := gen_random_uuid();
  stu uuid := gen_random_uuid();
  -- Базовий день: 10:00 Києва післязавтра. Журнал пише справжній now(), а
  -- правило «не частіше ніж раз на 20 годин» порівнює його з `_at` — тож усі
  -- «сьогодні» сценарію стоять щонайменше на 34 години попереду справжнього часу.
  d0 timestamptz := (((now() AT TIME ZONE 'Europe/Kyiv')::date + 2)::timestamp + interval '10 hours') AT TIME ZONE 'Europe/Kyiv';
  t0 timestamptz;
  res jsonb; row_ jsonb; st jsonb; n int; caught text; l1 uuid; kinds text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (tutor, 't66@replay.local', '{"first_name":"Марта","last_name":"Нова","role":"tutor","independent_workspace":true}'),
    (quiet, 'q66@replay.local', '{"first_name":"Тихий","last_name":"Репетитор","role":"tutor","independent_workspace":true}'),
    (admin, 'admin66@replay.local', '{"first_name":"Супер","last_name":"Адмін","role":"tutor","independent_workspace":true}'),
    (stu,   's66@replay.local', '{"first_name":"Учень","last_name":"Марти","role":"student"}');
  INSERT INTO public.platform_admins (user_id) VALUES (admin) ON CONFLICT DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = admin AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (admin, 'manager') ON CONFLICT DO NOTHING;
  PERFORM set_config('app.allow_independent_optin', '1', true);
  t0 := d0 - interval '1 hour';   -- реєстрація о 9:00 базового дня
  UPDATE public.tutor_workspace_settings SET independent_workspace = true, subscription_status = 'trial', trial_until = d0 + interval '30 days'
   WHERE tutor_id IN (tutor, quiet, admin);
  PERFORM set_config('app.allow_independent_optin', NULL, true);
  UPDATE public.tutor_workspace_settings SET marketing_opt_in = false WHERE tutor_id = quiet;
  UPDATE auth.users SET created_at = t0 WHERE id IN (tutor, quiet);

  -- ── (1) привітання — раз ────────────────────────────────────────────────────
  res := public.lifecycle_candidates(d0, 200);
  IF (res->>'quiet')::boolean THEN RAISE EXCEPTION 'ПРОВАЛ (1): 10:00 Києва — не тихі години: %', res; END IF;
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'welcome' THEN RAISE EXCEPTION 'ПРОВАЛ (1): новий репетитор мав отримати welcome, а є %', res; END IF;
  IF row_->>'first_name' <> 'Марта' OR row_->>'email' <> 't66@replay.local' OR row_->>'lang' <> 'uk' THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): імʼя/пошта/мова: %', row_;
  END IF;
  PERFORM public.lifecycle_record(tutor, 'welcome', '', ARRAY['email','inapp'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '2 hours', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): через дві години повторне повідомлення: %', res;
  END IF;
  RAISE NOTICE '✅ (1) привітання — один раз, з імʼям, поштою і мовою';

  -- ── (2) кроки онбордингу ────────────────────────────────────────────────────
  res := public.lifecycle_candidates(d0 + interval '1 day', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'no_student_d1' THEN RAISE EXCEPTION 'ПРОВАЛ (2): день 1 без учня → no_student_d1, а є %', res; END IF;
  PERFORM public.lifecycle_record(tutor, 'no_student_d1', '', ARRAY['email'], '{}'::jsonb);

  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (tutor, stu, 'Фізика', 400, 'UAH', 'independent');
  res := public.lifecycle_candidates(d0 + interval '2 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): день 2 з учнем — ще нічого не має йти: %', res;
  END IF;
  res := public.lifecycle_candidates(d0 + interval '3 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'no_lesson_d3' THEN RAISE EXCEPTION 'ПРОВАЛ (2): день 3 без уроку → no_lesson_d3, а є %', res; END IF;
  IF (row_->'numbers'->>'students')::int <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (2): цифри: %', row_->'numbers'; END IF;
  PERFORM public.lifecycle_record(tutor, 'no_lesson_d3', '', ARRAY['email'], '{}'::jsonb);

  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (tutor, stu, 'Фізика', d0 + interval '4 days', 60, 'completed', 'independent', tutor) RETURNING id INTO l1;
  UPDATE public.lesson_details SET student_price = 400, student_payment_status = 'unpaid' WHERE lesson_id = l1;
  res := public.lifecycle_candidates(d0 + interval '7 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'no_paid_d7' THEN RAISE EXCEPTION 'ПРОВАЛ (2): день 7 без оплати → no_paid_d7, а є %', res; END IF;
  IF (row_->'numbers'->>'debt_lessons')::int <> 1 OR (row_->'numbers'->>'debt_sum')::numeric <> 400 THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): борг у цифрах: %', row_->'numbers';
  END IF;
  PERFORM public.lifecycle_record(tutor, 'no_paid_d7', '', ARRAY['telegram'], '{}'::jsonb);
  RAISE NOTICE '✅ (2) день 1 → учень, день 3 → урок, день 7 → оплата; кожен крок один раз, з цифрами';

  -- ── (3) тріал: 7 днів, 2 дні, закінчився ────────────────────────────────────
  res := public.lifecycle_candidates(d0 + interval '23 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'trial_7_left' THEN RAISE EXCEPTION 'ПРОВАЛ (3): за 7 днів до кінця тріалу → trial_7_left, а є %', res; END IF;
  IF (row_->'numbers'->>'trial_days_left')::int NOT BETWEEN 6 AND 8 THEN RAISE EXCEPTION 'ПРОВАЛ (3): днів тріалу: %', row_->'numbers'; END IF;
  PERFORM public.lifecycle_record(tutor, 'trial_7_left', '', ARRAY['email'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '28 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'trial_2_left' THEN RAISE EXCEPTION 'ПРОВАЛ (3): за 2 дні → trial_2_left, а є %', res; END IF;
  PERFORM public.lifecycle_record(tutor, 'trial_2_left', '', ARRAY['email'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '31 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'trial_ended' THEN RAISE EXCEPTION 'ПРОВАЛ (3): після кінця → trial_ended, а є %', res; END IF;
  PERFORM public.lifecycle_record(tutor, 'trial_ended', '', ARRAY['email'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '32 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): «тріал закінчився» надіслано двічі: %', res;
  END IF;
  RAISE NOTICE '✅ (3) тріал: за 7 днів, за 2 дні, після кінця — по разу';

  -- ── (4) сплячі: цикл сну ────────────────────────────────────────────────────
  -- остання активність = справжній now() (урок, ставка й деталі записані «зараз»)
  res := public.lifecycle_candidates(d0 + interval '45 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'inactive_14' THEN RAISE EXCEPTION 'ПРОВАЛ (4): 14+ днів тиші → inactive_14, а є %', res; END IF;
  IF row_->>'cycle_key' = '' THEN RAISE EXCEPTION 'ПРОВАЛ (4): у сплячого має бути ключ циклу'; END IF;
  PERFORM public.lifecycle_record(tutor, 'inactive_14', row_->>'cycle_key', ARRAY['push'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '47 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): той самий цикл сну — друге повідомлення: %', res;
  END IF;
  -- людина зайшла (подія застосунку) → новий цикл; через 8 днів тиші — inactive_7
  INSERT INTO public.app_events (user_id, name, props, created_at) VALUES (tutor, 'app_open', '{}', d0 + interval '48 days');
  res := public.lifecycle_candidates(d0 + interval '50 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (4): 2 дні після візиту — ще не сплячий: %', res;
  END IF;
  res := public.lifecycle_candidates(d0 + interval '56 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = tutor::text;
  IF row_ IS NULL OR row_->>'kind' <> 'inactive_7' THEN RAISE EXCEPTION 'ПРОВАЛ (4): 8 днів після візиту → inactive_7, а є %', res; END IF;
  RAISE NOTICE '✅ (4) сплячі: одне повідомлення на цикл сну, візит відкриває новий цикл';

  -- ── (5) тихі години ─────────────────────────────────────────────────────────
  res := public.lifecycle_candidates(((d0 AT TIME ZONE 'Europe/Kyiv')::date::timestamp + interval '3 hours') AT TIME ZONE 'Europe/Kyiv', 200);
  IF NOT (res->>'quiet')::boolean OR jsonb_array_length(res->'rows') <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (5): о 3-й ночі має бути тихо: %', res; END IF;
  res := public.lifecycle_candidates(((d0 AT TIME ZONE 'Europe/Kyiv')::date::timestamp + interval '21 hours') AT TIME ZONE 'Europe/Kyiv', 200);
  IF NOT (res->>'quiet')::boolean THEN RAISE EXCEPTION 'ПРОВАЛ (5): о 21:00 має бути тихо: %', res; END IF;
  RAISE NOTICE '✅ (5) тихі години 20:00–09:00 Києва';

  -- ── (6) відписаний: лише привітання ─────────────────────────────────────────
  res := public.lifecycle_candidates(d0, 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = quiet::text;
  IF row_ IS NULL OR row_->>'kind' <> 'welcome' THEN RAISE EXCEPTION 'ПРОВАЛ (6): привітання йде і відписаному, а є %', res; END IF;
  PERFORM public.lifecycle_record(quiet, 'welcome', '', ARRAY['email'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '3 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = quiet::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (6): відписаний отримав крок онбордингу: %', res;
  END IF;
  RAISE NOTICE '✅ (6) відписаний від розсилок отримує лише привітання';

  -- ── (7) рахунок «нагадано за вас · повернуто» ───────────────────────────────
  -- нагадували вчора (справжній час: тригер ставить student_paid_at = now() при оплаті)
  INSERT INTO public.lesson_payment_reminders (lesson_id, tutor_id, student_id, reminder_kind, channel, sent_at)
    VALUES (l1, tutor, stu, 'manual', 'telegram', now() - interval '1 day'),
           (l1, tutor, stu, 'manual', 'email',    now() - interval '1 day');
  st := public.tutor_reminder_stats(tutor);
  IF (st->>'reminded_times')::int <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (7): два канали одного дня = одне нагадування, а є %', st; END IF;
  IF (st->>'recovered_sum')::numeric <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (7): без оплати нічого не повернуто: %', st; END IF;
  UPDATE public.lesson_details SET student_payment_status = 'paid' WHERE lesson_id = l1;
  st := public.tutor_reminder_stats(tutor);
  IF (st->>'recovered_sum')::numeric <> 400 OR (st->>'recovered_lessons')::int <> 1 OR st->>'currency' <> 'UAH' THEN
    RAISE EXCEPTION 'ПРОВАЛ (7): оплата після нагадування мала дати 400 ₴ повернутих: %', st;
  END IF;
  -- чужий репетитор чужі цифри не читає
  caught := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', quiet, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    st := public.tutor_reminder_stats(tutor);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (7): чужий репетитор прочитав чужі цифри'; END IF;
  -- знімок для першого дайджесту після підключення бота — ті самі предикати
  st := public.tutor_snapshot(tutor);
  IF NOT (st->>'is_tutor')::boolean OR (st->>'students')::int <> 1 OR (st->>'debt_lessons')::int <> 0 OR st->>'currency' <> 'UAH' THEN
    RAISE EXCEPTION 'ПРОВАЛ (7): знімок після оплати: 1 учень, 0 боргів, а є %', st;
  END IF;
  RAISE NOTICE '✅ (7) нагадано за вас: 1 раз; повернуто після нагадувань: 400 ₴; чужому — ні; знімок збігається';

  -- ── (8) сегменти розсилки за справжніми статусами ───────────────────────────
  INSERT INTO public.user_telegram_links (user_id, chat_id) VALUES (tutor, 123456789);
  UPDATE public.tutor_workspace_settings SET subscription_status = 'active', subscription_until = NULL WHERE tutor_id = tutor;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.get_marketing_recipients('pro_active') r WHERE r.user_id = tutor AND r.telegram_chat_id = 123456789;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (8): active репетитор має бути в сегменті «платять» з Telegram-чатом (n=%)', n; END IF;
  SELECT count(*) INTO n FROM public.get_marketing_recipients('expired') r WHERE r.user_id = tutor;
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (8): active не є «закінчився»'; END IF;
  SELECT count(*) INTO n FROM public.get_marketing_recipients('has_telegram') r WHERE r.user_id = tutor;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (8): сегмент «є Telegram» не бачить чат'; END IF;
  SELECT count(*) INTO n FROM public.get_marketing_recipients('all_independent') r WHERE r.user_id = quiet;
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (8): відписаний потрапив у розсилку'; END IF;
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.tutor_workspace_settings SET subscription_status = 'cancelled' WHERE tutor_id = tutor;
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.get_marketing_recipients('expired') r WHERE r.user_id = tutor;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (8): cancelled має бути в сегменті «закінчився»'; END IF;
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.tutor_workspace_settings SET subscription_status = 'trial', trial_until = now() - interval '1 day' WHERE tutor_id = tutor;
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.get_marketing_recipients('expired') r WHERE r.user_id = tutor;
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (8): закінчений тріал має бути в сегменті «закінчився»'; END IF;
  SELECT count(*) INTO n FROM public.get_marketing_recipients('trial') r WHERE r.user_id = tutor;
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (8): закінчений тріал не є «на тріалі»'; END IF;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE '✅ (8) сегменти «платять» / «закінчився» / «є Telegram» рахуються за справжніми статусами';

  -- ── (9) з браузера — ні ─────────────────────────────────────────────────────
  caught := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    res := public.lifecycle_candidates(now(), 10);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (9): lifecycle_candidates доступна з браузера'; END IF;
  caught := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', tutor, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    PERFORM public.lifecycle_record(tutor, 'welcome', 'x', ARRAY['email'], '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  IF caught IS NULL THEN RAISE EXCEPTION 'ПРОВАЛ (9): lifecycle_record доступна з браузера'; END IF;
  -- суперадмін бачить зведення
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  res := public.lifecycle_summary(30);
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT string_agg(x->>'kind', ',' ORDER BY x->>'kind') INTO kinds FROM jsonb_array_elements(res) x;
  IF kinds IS NULL OR kinds NOT LIKE '%welcome%' OR kinds NOT LIKE '%trial_ended%' THEN RAISE EXCEPTION 'ПРОВАЛ (9): зведення не бачить журналу: %', res; END IF;
  RAISE NOTICE '✅ (9) кандидати/журнал — лише службова роль; зведення — суперадмін';
END $$;

ROLLBACK;
