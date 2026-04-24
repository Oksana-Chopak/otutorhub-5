-- Recreate lesson triggers that were accidentally dropped
-- 1) updated_at maintenance
DROP TRIGGER IF EXISTS trg_lessons_updated ON public.lessons;
CREATE TRIGGER trg_lessons_updated
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Auto-set/clear student_paid_at and tutor_paid_at when payment status changes
DROP TRIGGER IF EXISTS trg_set_payment_dates ON public.lessons;
CREATE TRIGGER trg_set_payment_dates
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.set_payment_dates();

-- 3) Autofill student_price / tutor_payout from rates on insert
DROP TRIGGER IF EXISTS trg_autofill_lesson_prices ON public.lessons;
CREATE TRIGGER trg_autofill_lesson_prices
  BEFORE INSERT ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.autofill_lesson_prices();

-- 4) Field-level protection (the modern version that allows independent tutors)
DROP TRIGGER IF EXISTS trg_protect_lesson_fields ON public.lessons;
CREATE TRIGGER trg_protect_lesson_fields
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_lesson_fields();

-- 5) Audit log of financial changes
DROP TRIGGER IF EXISTS trg_log_lesson_financial_changes ON public.lessons;
CREATE TRIGGER trg_log_lesson_financial_changes
  AFTER UPDATE ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.log_lesson_financial_changes();