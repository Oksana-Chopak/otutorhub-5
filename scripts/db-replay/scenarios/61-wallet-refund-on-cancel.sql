-- Сценарій: передоплата 8 уроків = 8 ПРОВЕДЕНИХ оплачених уроків, навіть якщо один
-- із закритих передоплатою уроків скасували (13.11, скарга власниці: «передплатила 8,
-- оплаченими позначено 7»).
--   (1) передоплата 8 → 8 уроків оплачено, баланс 0;
--   (2) репетиторка (під своєю роллю) скасовує один → кредит повертається і закриває
--       наступний, девʼятий урок: оплачених нескасованих знову 8, баланс 0;
--   (4) урок, позначений оплаченим руками (без гаманця), скасування не чіпає;
--   (5) кредит, що повернувся без вільного уроку, закриває наступний новий урок;
--   (6) урок повернули зі скасованих → гаманець закриває його одразу.
BEGIN;
SET LOCAL client_min_messages = notice;
DO $$
DECLARE
  ind uuid := gen_random_uuid(); stu uuid := gen_random_uuid();
  ids uuid[] := '{}'; lid uuid; i int; n int; bal record; hand uuid; st text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (ind, 'i61@replay.local', '{"first_name":"Само","last_name":"Стійна","role":"tutor"}'),
    (stu, 's61@replay.local', '{"first_name":"Ніна","last_name":"Учениця"}');
  PERFORM set_config('app.allow_independent_optin', '1', true);
  UPDATE public.tutor_workspace_settings SET independent_workspace = true, hub_id = NULL WHERE tutor_id = ind;
  PERFORM set_config('app.allow_independent_optin', NULL, true);
  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
    VALUES (ind, stu, 'Математика', 500, 'UAH', 'independent');

  -- урок, оплачений руками ДО передоплати (гаманця не торкався)
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (ind, stu, 'Математика', now() + interval '20 days', 60, 'scheduled', 'independent', ind) RETURNING id INTO hand;
  UPDATE public.lesson_details SET student_price = 500, student_payment_status = 'paid', student_paid_at = now() WHERE lesson_id = hand;

  FOR i IN 1..9 LOOP
    INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
      VALUES (ind, stu, 'Математика', now() + (i || ' days')::interval, 60, 'scheduled', 'independent', ind) RETURNING id INTO lid;
    UPDATE public.lesson_details SET student_price = 500 WHERE lesson_id = lid;
    ids := ids || lid;
  END LOOP;

  -- (1) передоплата 8 уроків
  INSERT INTO public.student_wallet_transactions (tutor_id, student_id, kind, lessons_delta, amount_delta, created_by)
    VALUES (ind, stu, 'topup', 8, 0, ind);
  SELECT count(*) INTO n FROM public.lesson_details d WHERE d.lesson_id = ANY(ids) AND d.student_payment_status = 'paid';
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  IF n <> 8 OR bal.lessons_balance <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (1): оплачено % з 8, баланс %', n, bal.lessons_balance; END IF;
  RAISE NOTICE '✅ (1) передоплата 8 уроків закрила 8 уроків';

  -- (2) репетиторка скасовує перший оплачений урок
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ind, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  UPDATE public.lessons SET status = 'cancelled' WHERE id = ids[1];
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO n FROM public.lesson_details d JOIN public.lessons l ON l.id = d.lesson_id
   WHERE d.lesson_id = ANY(ids) AND d.student_payment_status = 'paid' AND l.status <> 'cancelled';
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  SELECT d.student_payment_status INTO st FROM public.lesson_details d WHERE d.lesson_id = ids[1];
  IF n <> 8 OR bal.lessons_balance <> 0 OR st <> 'unpaid' THEN
    RAISE EXCEPTION 'ПРОВАЛ (2): після скасування оплачених нескасованих % (треба 8), баланс %, скасований урок %', n, bal.lessons_balance, st;
  END IF;
  RAISE NOTICE '✅ (2) скасований урок повернув кредит, він закрив девʼятий: оплачених знову 8';

  -- (4) оплачений руками урок: скасування грошей не чіпає
  UPDATE public.lessons SET status = 'cancelled' WHERE id = hand;
  SELECT d.student_payment_status INTO st FROM public.lesson_details d WHERE d.lesson_id = hand;
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  IF st <> 'paid' OR bal.lessons_balance <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (4): оплачений руками став %, баланс %', st, bal.lessons_balance; END IF;
  RAISE NOTICE '✅ (4) урок, оплачений руками, лишився як був';

  -- (5) повернутий кредит не губиться: новий урок після скасування теж закривається
  UPDATE public.lessons SET status = 'cancelled' WHERE id = ids[2];
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by)
    VALUES (ind, stu, 'Математика', now() + interval '30 days', 60, 'scheduled', 'independent', ind) RETURNING id INTO lid;
  UPDATE public.lesson_details SET student_price = 500 WHERE lesson_id = lid;
  SELECT d.student_payment_status INTO st FROM public.lesson_details d WHERE d.lesson_id = lid;
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  IF st <> 'paid' OR bal.lessons_balance <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (5): новий урок %, баланс %', st, bal.lessons_balance; END IF;
  RAISE NOTICE '✅ (5) кредит зі скасованого уроку закрив наступний новий урок';

  -- (6) урок повернули зі скасованих — кредит не лежить без діла
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  INSERT INTO public.student_wallet_transactions (tutor_id, student_id, kind, lessons_delta, amount_delta, created_by)
    VALUES (ind, stu, 'topup', 1, 0, ind);   -- у гаманці 1 урок, вільних неоплачених немає
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ind, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  UPDATE public.lessons SET status = 'scheduled' WHERE id = ids[1];
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT d.student_payment_status INTO st FROM public.lesson_details d WHERE d.lesson_id = ids[1];
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  IF st <> 'paid' OR bal.lessons_balance <> 0 THEN RAISE EXCEPTION 'ПРОВАЛ (6): повернутий урок %, баланс % (кредит лежить без діла)', st, bal.lessons_balance; END IF;
  RAISE NOTICE '✅ (6) повернутий зі скасованих урок закрився передоплатою';

  -- (7) скасування ЗІ ШТРАФОМ (штраф записано до зміни статусу, як це робить застосунок):
  --     списання лишається, кредит не повертається
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  n := bal.lessons_balance;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ind, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.update_lesson_details_safe(ids[3], jsonb_build_object('student_price', 500, 'is_cancellation_fee', true));
  UPDATE public.lessons SET status = 'cancelled' WHERE id = ids[3];
  RESET role; PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT d.student_payment_status INTO st FROM public.lesson_details d WHERE d.lesson_id = ids[3];
  SELECT * INTO bal FROM public.wallet_balance_internal(ind, stu);
  IF st <> 'paid' OR bal.lessons_balance <> n THEN RAISE EXCEPTION 'ПРОВАЛ (7): урок зі штрафом %, баланс % (було %)', st, bal.lessons_balance, n; END IF;
  RAISE NOTICE '✅ (7) скасування зі штрафом лишило списання на місці';
END $$;
ROLLBACK;
