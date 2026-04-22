-- Restore triggers on public.lessons that were accidentally dropped along with duplicates
DROP TRIGGER IF EXISTS trg_lessons_updated ON public.lessons;
CREATE TRIGGER trg_lessons_updated
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_lessons_autofill_prices ON public.lessons;
CREATE TRIGGER trg_lessons_autofill_prices
BEFORE INSERT ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.autofill_lesson_prices();

DROP TRIGGER IF EXISTS trg_set_payment_dates ON public.lessons;
CREATE TRIGGER trg_set_payment_dates
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.set_payment_dates();

DROP TRIGGER IF EXISTS trg_log_lesson_financials ON public.lessons;
CREATE TRIGGER trg_log_lesson_financials
AFTER UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.log_lesson_financial_changes();

-- Drop duplicate delete-profile policy (kept "Manager deletes any profile")
DROP POLICY IF EXISTS "Manager deletes profiles" ON public.profiles;

-- Ensure each person has exactly one role: deduplicate, then add unique constraint
WITH ranked AS (
  SELECT id, user_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM public.user_roles
)
DELETE FROM public.user_roles ur USING ranked r
WHERE ur.id = r.id AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND conname  = 'user_roles_user_id_unique'
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);
  END IF;
END$$;