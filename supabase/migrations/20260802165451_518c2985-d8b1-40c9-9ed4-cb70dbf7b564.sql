DO $$
DECLARE
  _name text := 'Ніна';
  _pair record; _lesson record;
  _lessons_bal int; _amount_bal numeric; _done int;
BEGIN
  FOR _pair IN
    SELECT b.tutor_id, b.student_id,
           ps.first_name || ' ' || COALESCE(ps.last_name,'') AS sname
    FROM public.student_wallet_balances b
    JOIN public.profiles ps ON ps.id = b.student_id
    WHERE ps.first_name ILIKE _name || '%'
      AND (COALESCE(b.lessons_balance,0) > 0 OR COALESCE(b.amount_balance,0) > 0)
  LOOP
    SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
    FROM public.wallet_balance_internal(_pair.tutor_id, _pair.student_id);
    _done := 0;
    FOR _lesson IN
      SELECT ld.lesson_id, ld.student_price
      FROM public.lesson_details ld
      JOIN public.lessons l ON l.id = ld.lesson_id
      WHERE l.tutor_id = _pair.tutor_id AND l.student_id = _pair.student_id
        AND ld.student_payment_status = 'paid'
        AND NOT EXISTS (SELECT 1 FROM public.student_wallet_transactions t
                         WHERE t.lesson_id = ld.lesson_id
                           AND t.kind IN ('lesson_charge','refund'))
      ORDER BY l.starts_at ASC
    LOOP
      IF COALESCE(_lessons_bal,0) > 0 THEN
        INSERT INTO public.student_wallet_transactions
          (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
        VALUES (_pair.tutor_id, _pair.student_id, 'lesson_charge', -1, 0, _lesson.lesson_id,
                'звірка: ручне «оплачено» списано з передоплати', NULL);
        _lessons_bal := _lessons_bal - 1; _done := _done + 1;
      ELSIF COALESCE(_amount_bal,0) >= COALESCE(_lesson.student_price,0)
            AND COALESCE(_lesson.student_price,0) > 0 THEN
        INSERT INTO public.student_wallet_transactions
          (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
        VALUES (_pair.tutor_id, _pair.student_id, 'lesson_charge', 0, -_lesson.student_price, _lesson.lesson_id,
                'звірка: ручне «оплачено» списано з передоплати', NULL);
        _amount_bal := _amount_bal - _lesson.student_price; _done := _done + 1;
      ELSE
        EXIT;
      END IF;
    END LOOP;
    RAISE NOTICE 'Пара % — списано проводок: %', _pair.sname, _done;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.wallet_charge_on_manual_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor uuid; _student uuid; _net_l int; _net_a numeric;
  _lessons_bal int; _amount_bal numeric;
BEGIN
  IF NEW.student_payment_status = 'paid'
     AND COALESCE(OLD.student_payment_status, 'unpaid') <> 'paid' THEN
    SELECT l.tutor_id, l.student_id INTO _tutor, _student
    FROM public.lessons l WHERE l.id = NEW.lesson_id;
    IF _tutor IS NULL OR _student IS NULL THEN RETURN NEW; END IF;

    SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0)
      INTO _net_l, _net_a
    FROM public.student_wallet_transactions
    WHERE lesson_id = NEW.lesson_id AND kind IN ('lesson_charge','refund');
    IF _net_l <> 0 OR _net_a <> 0 THEN RETURN NEW; END IF;

    SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
    FROM public.wallet_balance_internal(_tutor, _student);

    IF COALESCE(_lessons_bal,0) > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor, _student, 'lesson_charge', -1, 0, NEW.lesson_id,
              'auto: manual paid settled from prepaid lessons', NULL);
    ELSIF COALESCE(_amount_bal,0) >= COALESCE(NEW.student_price,0)
          AND COALESCE(NEW.student_price,0) > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor, _student, 'lesson_charge', 0, -NEW.student_price, NEW.lesson_id,
              'auto: manual paid settled from prepaid amount', NULL);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wallet_charge_on_manual_paid ON public.lesson_details;
CREATE TRIGGER trg_wallet_charge_on_manual_paid
AFTER UPDATE OF student_payment_status ON public.lesson_details
FOR EACH ROW
WHEN (NEW.student_payment_status = 'paid' AND OLD.student_payment_status IS DISTINCT FROM NEW.student_payment_status)
EXECUTE FUNCTION public.wallet_charge_on_manual_paid();