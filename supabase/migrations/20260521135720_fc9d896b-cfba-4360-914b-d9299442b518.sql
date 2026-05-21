-- Auto-consume wallet balance on topup: when a student tops up their wallet
-- (or wallet receives lesson credits), automatically apply that balance to
-- existing unpaid lessons for that tutor↔student pair, oldest first.
-- This fixes the bug where prepayment shows but unpaid lessons stay "Väntar".

CREATE OR REPLACE FUNCTION public.wallet_autoapply_on_topup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lessons_bal int;
  _amount_bal numeric;
  _lesson record;
BEGIN
  -- Only react to positive deltas (topup/credit), not charges/refunds out
  IF COALESCE(NEW.lessons_delta, 0) <= 0 AND COALESCE(NEW.amount_delta, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Get fresh balance for this pair
  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.get_wallet_balance(NEW.tutor_id, NEW.student_id);

  -- Loop through unpaid lessons for this pair, oldest first
  FOR _lesson IN
    SELECT ld.lesson_id, ld.student_price
    FROM public.lesson_details ld
    JOIN public.lessons l ON l.id = ld.lesson_id
    WHERE l.tutor_id = NEW.tutor_id
      AND l.student_id = NEW.student_id
      AND ld.student_payment_status = 'unpaid'
      AND COALESCE(ld.student_price, 0) > 0
      AND l.status <> 'cancelled'
    ORDER BY l.starts_at ASC
  LOOP
    IF _lessons_bal > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES
        (NEW.tutor_id, NEW.student_id, 'lesson_charge', -1, 0, _lesson.lesson_id,
         'auto: applied prepay to existing lesson', NEW.created_by);
      UPDATE public.lesson_details
        SET student_payment_status = 'paid', student_paid_at = now()
        WHERE lesson_id = _lesson.lesson_id;
      _lessons_bal := _lessons_bal - 1;
    ELSIF _amount_bal >= _lesson.student_price THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES
        (NEW.tutor_id, NEW.student_id, 'lesson_charge', 0, -_lesson.student_price, _lesson.lesson_id,
         'auto: applied prepay to existing lesson', NEW.created_by);
      UPDATE public.lesson_details
        SET student_payment_status = 'paid', student_paid_at = now()
        WHERE lesson_id = _lesson.lesson_id;
      _amount_bal := _amount_bal - _lesson.student_price;
    ELSE
      EXIT; -- not enough balance for the cheapest remaining lesson
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_autoapply_on_topup ON public.student_wallet_transactions;
CREATE TRIGGER trg_wallet_autoapply_on_topup
AFTER INSERT ON public.student_wallet_transactions
FOR EACH ROW
WHEN (NEW.kind = 'topup' OR NEW.lessons_delta > 0 OR NEW.amount_delta > 0)
EXECUTE FUNCTION public.wallet_autoapply_on_topup();