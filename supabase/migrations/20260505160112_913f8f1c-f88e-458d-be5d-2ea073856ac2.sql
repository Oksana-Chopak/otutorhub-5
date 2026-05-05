CREATE OR REPLACE FUNCTION public.set_lesson_details_payment_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.student_payment_status = 'paid' AND NEW.student_paid_at IS NULL THEN
      NEW.student_paid_at := now();
    END IF;
    IF NEW.tutor_payout_status = 'paid' AND NEW.tutor_paid_at IS NULL THEN
      NEW.tutor_paid_at := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.student_payment_status IS DISTINCT FROM OLD.student_payment_status THEN
      NEW.student_paid_at := CASE WHEN NEW.student_payment_status = 'paid' THEN now() ELSE NULL END;
    END IF;
    IF NEW.tutor_payout_status IS DISTINCT FROM OLD.tutor_payout_status THEN
      NEW.tutor_paid_at := CASE WHEN NEW.tutor_payout_status = 'paid' THEN now() ELSE NULL END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_details_payment_dates ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_payment_dates
BEFORE INSERT OR UPDATE ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.set_lesson_details_payment_dates();