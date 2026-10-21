-- Сценарій: ланцюжок — підтвердження пошти і повернення після тріалу (19.10,
-- рішення власниці: «перше і друге тільки зроби»). Міграція 20261019180000.
-- Час — параметр `_at` (10:00 Києва післязавтра, як у сценарії 66).
-- Перевіряємо:
--   (1) не підтвердив пошту: на день 1–7 — один «unconfirmed_d1», і НЕ welcome;
--       у перші 24 години без підтвердження — нічого (welcome вів би в замкнені двері);
--       після 8-го дня — тиша, доки не підтвердить; підтвердив — звичайні кроки;
--   (2) тріал минув, учні є, Pro не купив: «win_back» у вікні 10–30 днів (цикл 0),
--       потім 30–60 (цикл 1), по одному на вікно; після 120 днів — тиша;
--       «сплячі» (inactive_*) такому НЕ йдуть — ядро замкнене;
--   (3) тріал минув, учнів немає — нічого;
--   (4) крони: нагадування про оплату й ланцюжок — на 6 запусків на добу, старого
--       щогодинного немає.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  unc uuid := gen_random_uuid();     -- не підтвердив пошту, зареєструвався 2 дні тому
  fresh uuid := gen_random_uuid();   -- не підтвердив, зареєструвався 6 годин тому
  lap uuid := gen_random_uuid();     -- тріал минув 20 днів тому, є учень і борг
  empty_ uuid := gen_random_uuid();  -- тріал минув, учнів немає
  stu uuid := gen_random_uuid();
  d0 timestamptz := (((now() AT TIME ZONE 'Europe/Kyiv')::date + 2)::timestamp + interval '10 hours') AT TIME ZONE 'Europe/Kyiv';
  res jsonb; row_ jsonb; l1 uuid; n int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (unc,    'unc67@replay.local',   '{"first_name":"Ніна","last_name":"Нова","role":"tutor","independent_workspace":true}'),
    (fresh,  'fresh67@replay.local', '{"first_name":"Свіжа","last_name":"Нова","role":"tutor","independent_workspace":true}'),
    (lap,    'lap67@replay.local',   '{"first_name":"Олег","last_name":"Давній","role":"tutor","independent_workspace":true}'),
    (empty_, 'empty67@replay.local', '{"first_name":"Порожній","last_name":"Давній","role":"tutor","independent_workspace":true}'),
    (stu,    'stu67@replay.local',   '{"first_name":"Учень","last_name":"Олега","role":"student"}');
  PERFORM set_config('app.allow_independent_optin', '1', true);
  UPDATE public.tutor_workspace_settings SET independent_workspace = true, subscription_status = 'trial', trial_until = d0 + interval '28 days'
   WHERE tutor_id IN (unc, fresh);
  UPDATE public.tutor_workspace_settings SET independent_workspace = true, subscription_status = 'trial', trial_until = d0 - interval '20 days'
   WHERE tutor_id IN (lap, empty_);
  PERFORM set_config('app.allow_independent_optin', NULL, true);
  UPDATE auth.users SET created_at = d0 - interval '2 days',  email_confirmed_at = NULL WHERE id = unc;
  UPDATE auth.users SET created_at = d0 - interval '6 hours', email_confirmed_at = NULL WHERE id = fresh;
  UPDATE auth.users SET created_at = d0 - interval '60 days', email_confirmed_at = d0 - interval '60 days' WHERE id IN (lap, empty_);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (lap, stu, 'Хімія', 500, 'UAH', 'independent');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (lap, stu, 'Хімія', d0 - interval '40 days', 60, 'completed', 'independent', lap) RETURNING id INTO l1;
  UPDATE public.lesson_details SET student_price = 500, student_payment_status = 'unpaid' WHERE lesson_id = l1;

  -- ── (1) не підтвердив пошту ─────────────────────────────────────────────────
  res := public.lifecycle_candidates(d0, 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = unc::text;
  IF row_ IS NULL OR row_->>'kind' <> 'unconfirmed_d1' THEN RAISE EXCEPTION 'ПРОВАЛ (1): день 2 без підтвердження → unconfirmed_d1, а є %', res; END IF;
  IF row_->>'email' <> 'unc67@replay.local' THEN RAISE EXCEPTION 'ПРОВАЛ (1): пошта для повторного листа: %', row_; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = fresh::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): перші 24 години без підтвердження — нічого (не welcome): %', res;
  END IF;
  PERFORM public.lifecycle_record(unc, 'unconfirmed_d1', '', ARRAY['email_confirm'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '1 day', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = unc::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): повторний лист підтвердження — лише раз: %', res;
  END IF;
  res := public.lifecycle_candidates(d0 + interval '10 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = unc::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (1): після 8-го дня без підтвердження — тиша, а є %', res;
  END IF;
  -- підтвердив на 12-й день → звичайний крок «додай учня» (день < 14, учнів 0)
  UPDATE auth.users SET email_confirmed_at = d0 + interval '10 days' WHERE id = unc;
  res := public.lifecycle_candidates(d0 + interval '10 days' + interval '1 hour', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = unc::text;
  IF row_ IS NULL OR row_->>'kind' <> 'no_student_d1' THEN RAISE EXCEPTION 'ПРОВАЛ (1): після підтвердження → no_student_d1, а є %', res; END IF;
  RAISE NOTICE '✅ (1) непідтверджена пошта: один повторний лист на день 1–7, без welcome; після підтвердження — звичайні кроки';

  -- ── (2) повернення після тріалу ─────────────────────────────────────────────
  res := public.lifecycle_candidates(d0, 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = lap::text;
  IF row_ IS NULL OR row_->>'kind' <> 'win_back' THEN RAISE EXCEPTION 'ПРОВАЛ (2): тріал минув 20 днів тому, є учень → win_back, а є %', res; END IF;
  IF row_->>'cycle_key' <> '0' THEN RAISE EXCEPTION 'ПРОВАЛ (2): вікно 10–30 днів = цикл 0, а є %', row_->>'cycle_key'; END IF;
  IF (row_->'numbers'->>'students')::int <> 1 OR (row_->'numbers'->>'debt_lessons')::int <> 1
     OR (row_->'numbers'->'debt_by_cur'->>'UAH')::numeric <> 500 THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): цифри повернення: %', row_->'numbers';
  END IF;
  PERFORM public.lifecycle_record(lap, 'win_back', '0', ARRAY['email'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '5 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = lap::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): те саме вікно — друге повідомлення (і жодних «сплячих»): %', res;
  END IF;
  res := public.lifecycle_candidates(d0 + interval '12 days', 200);
  SELECT x INTO row_ FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = lap::text;
  IF row_ IS NULL OR row_->>'kind' <> 'win_back' OR row_->>'cycle_key' <> '1' THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): 32 дні після кінця → win_back цикл 1, а є %', res;
  END IF;
  PERFORM public.lifecycle_record(lap, 'win_back', '1', ARRAY['email'], '{}'::jsonb);
  res := public.lifecycle_candidates(d0 + interval '101 days', 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = lap::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): 121 день після кінця тріалу — тиша, а є %', res;
  END IF;
  RAISE NOTICE '✅ (2) повернення: по одному на вікно 10–30 і 30–60 днів, з цифрами; після 120 днів — тиша; сплячих немає';

  -- ── (3) тріал минув, учнів немає — нічого ───────────────────────────────────
  res := public.lifecycle_candidates(d0, 200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(res->'rows') x WHERE x->>'user_id' = empty_::text) THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): без учнів після тріалу нічого не йде, а є %', res;
  END IF;
  RAISE NOTICE '✅ (3) тріал минув без учнів — тиша';

  -- ── (4) крони на 6 запусків ────────────────────────────────────────────────
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'payment-reminders-6x' AND schedule = '5 6-18/2 * * *';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (4): payment-reminders-6x не на 6 запусках'; END IF;
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'lifecycle-nudges' AND schedule = '7 6-17/2 * * *';
  IF n <> 1 THEN RAISE EXCEPTION 'ПРОВАЛ (4): lifecycle-nudges не на 6 запусках'; END IF;
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'payment-reminders-hourly';
  IF n <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (4): старий щогодинний крон живий'; END IF;
  RAISE NOTICE '✅ (4) крони: 6 запусків на добу';
END $$;

ROLLBACK;
