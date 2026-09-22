-- Сценарій: видалення акаунта (14.09, скарга живого користувача «зареєструвалась
-- помилково як учень, видалити акаунт не можу»). Тоді `purge_user_data` падала на
-- неіснуючій колонці, і видалити акаунт не міг НІХТО — пряма вимога сторів
-- (App Store 5.1.1(v), Google Play). Кодифікує доказ із ledger 15.09: користувач із
-- профілем, контактами, роллю і токеном розсилки → purge як це робить edge
-- `delete-account` (service role, auth.uid() = NULL) → без помилки, слідів немає,
-- пошта звільнена (is_pending_email не вважає її зайнятою).
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  u uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  n int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (u, 'oops-student@test.local', '{"first_name":"Помилкова","last_name":"Реєстрація","role":"student"}'),
    (t, 'her-tutor@test.local',   '{"first_name":"Її","last_name":"Репетитор","role":"tutor","independent_workspace":true}');
  INSERT INTO public.marketing_unsubscribe_tokens (token, email) VALUES ('tok_' || u::text, 'oops-student@test.local');
  -- звʼязок з репетитором і урок — щоб було що чистити
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, source) VALUES (t, u, 'Математика', 500, 'independent');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source)
    VALUES (t, u, 'Математика', now() + interval '1 day', 60, t, 'independent');

  SELECT count(*) INTO n FROM public.profiles WHERE id = u;
  IF n <> 1 THEN RAISE EXCEPTION 'підготовка: профіль не створено'; END IF;

  PERFORM public.purge_user_data(u);

  SELECT count(*) INTO n FROM public.profiles WHERE id = u;
  IF n <> 0 THEN RAISE EXCEPTION 'purge_user_data: профіль лишився'; END IF;
  SELECT count(*) INTO n FROM public.profile_contacts WHERE user_id = u;
  IF n <> 0 THEN RAISE EXCEPTION 'purge_user_data: контакти лишились'; END IF;
  SELECT count(*) INTO n FROM public.user_roles WHERE user_id = u;
  IF n <> 0 THEN RAISE EXCEPTION 'purge_user_data: роль лишилась'; END IF;
  SELECT count(*) INTO n FROM public.marketing_unsubscribe_tokens WHERE email = 'oops-student@test.local';
  IF n <> 0 THEN RAISE EXCEPTION 'purge_user_data: токен розсилки лишився (той самий рядок, що падав 14.09)'; END IF;
  SELECT count(*) INTO n FROM public.student_rates WHERE student_id = u;
  IF n <> 0 THEN RAISE EXCEPTION 'purge_user_data: пара з репетитором лишилась'; END IF;
  IF public.is_pending_email('oops-student@test.local') THEN
    RAISE EXCEPTION 'після видалення пошта досі вважається зайнятою';
  END IF;

  RAISE NOTICE '✅ видалення акаунта: purge_user_data проходить; профіль, контакти, роль, токен розсилки і пара — зникли; пошта вільна';
END $$;

ROLLBACK;
