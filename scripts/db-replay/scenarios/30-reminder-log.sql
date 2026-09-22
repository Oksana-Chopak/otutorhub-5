-- Сценарій: лог нагадувань про оплату (15.09 + 22.09).
-- 15.09: крон писав у лог вид, якого CHECK не приймав → вставка падала мовчки →
-- дедуп не працював → учень отримував нагадування щогодини. 22.09: унікальний ключ
-- змінився (додано student_id), а код лишився зі старим onConflict → 42P10.
-- Тут: (1) кожен вид, який пише код, приймається CHECK-ом; (2) upsert РІВНО з тим
-- набором колонок, що в коді (`_shared/paymentReminder.ts`), проходить і дедуплікує;
-- (3) два учасники одного групового уроку не конфліктують між собою.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  t uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  l uuid;
  k text;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (t,  'rem-tutor@test.local', '{"first_name":"Р","last_name":"Т","role":"tutor","independent_workspace":true}'),
    (s1, 'rem-s1@test.local',    '{"first_name":"У","last_name":"1","role":"student"}'),
    (s2, 'rem-s2@test.local',    '{"first_name":"У","last_name":"2","role":"student"}');
  INSERT INTO public.lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source)
    VALUES (t, s1, 'Математика', now() - interval '2 day', 60, t, 'independent') RETURNING id INTO l;

  -- (1) усі види, які пише код: крон (before/after/debt_1..4), ручне, кнопка Telegram, передоплата
  FOREACH k IN ARRAY ARRAY['prepaid','before_lesson','after_lesson','manual','telegram_button','debt_1','debt_2','debt_3','debt_4'] LOOP
    INSERT INTO public.lesson_payment_reminders (lesson_id, tutor_id, student_id, reminder_kind, channel)
    VALUES (l, t, s1, k, 'push')
    ON CONFLICT (lesson_id, student_id, reminder_kind, channel) DO NOTHING;
  END LOOP;
  SELECT count(*) INTO n FROM public.lesson_payment_reminders WHERE lesson_id = l AND student_id = s1;
  IF n <> 9 THEN RAISE EXCEPTION 'CHECK reminder_kind не приймає один із видів, що пише код (є % з 9)', n; END IF;

  -- (2) повтор того самого нагадування — дедуп: рядків не додається, помилки немає
  INSERT INTO public.lesson_payment_reminders (lesson_id, tutor_id, student_id, reminder_kind, channel)
  VALUES (l, t, s1, 'manual', 'push')
  ON CONFLICT (lesson_id, student_id, reminder_kind, channel) DO NOTHING;
  SELECT count(*) INTO n FROM public.lesson_payment_reminders WHERE lesson_id = l AND student_id = s1 AND reminder_kind = 'manual';
  IF n <> 1 THEN RAISE EXCEPTION 'дедуп ручного нагадування не працює: % рядків', n; END IF;

  -- (3) другий учасник того самого уроку (група) — свій рядок, без конфлікту з першим
  INSERT INTO public.lesson_payment_reminders (lesson_id, tutor_id, student_id, reminder_kind, channel)
  VALUES (l, t, s2, 'after_lesson', 'push')
  ON CONFLICT (lesson_id, student_id, reminder_kind, channel) DO NOTHING;
  SELECT count(*) INTO n FROM public.lesson_payment_reminders WHERE lesson_id = l AND reminder_kind = 'after_lesson';
  IF n <> 2 THEN RAISE EXCEPTION 'другий учасник групи випав із логу (є % замість 2)', n; END IF;

  RAISE NOTICE '✅ лог нагадувань: 9 видів приймаються · дедуп працює · учасники групи не конфліктують';
END $$;

ROLLBACK;
