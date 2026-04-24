-- Remove duplicates I just created. The pre-existing triggers (with different names) remain active.
DROP TRIGGER IF EXISTS trg_lessons_updated ON public.lessons;
DROP TRIGGER IF EXISTS trg_set_payment_dates ON public.lessons;
DROP TRIGGER IF EXISTS trg_autofill_lesson_prices ON public.lessons;
DROP TRIGGER IF EXISTS trg_protect_lesson_fields ON public.lessons;
DROP TRIGGER IF EXISTS trg_log_lesson_financial_changes ON public.lessons;