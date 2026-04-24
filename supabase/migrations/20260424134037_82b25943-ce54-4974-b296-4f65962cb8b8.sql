-- Remove old trigger that only allowed managers; protect_lesson_fields_trg already covers this with proper independent-tutor logic
DROP TRIGGER IF EXISTS trg_lessons_protect_financials ON public.lessons;

-- Remove duplicate triggers
DROP TRIGGER IF EXISTS trg_autofill_lesson_prices ON public.lessons;
DROP TRIGGER IF EXISTS trg_lessons_updated ON public.lessons;
DROP TRIGGER IF EXISTS trg_set_payment_dates ON public.lessons;