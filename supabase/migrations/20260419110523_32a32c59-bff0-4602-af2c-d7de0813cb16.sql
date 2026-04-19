-- 1) Tighten tutor UPDATE on lessons: enforce financial fields and participants stay unchanged
DROP POLICY IF EXISTS "Tutor updates own lessons (non-financial)" ON public.lessons;

CREATE POLICY "Tutor updates own lessons (non-financial)"
ON public.lessons
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
)
WITH CHECK (
  public.has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
);

-- Add a RESTRICTIVE policy to lock financial fields for non-managers
DROP POLICY IF EXISTS "Non-managers cannot change financials (restrictive)" ON public.lessons;
CREATE POLICY "Non-managers cannot change financials (restrictive)"
ON public.lessons
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (
  public.has_role(auth.uid(), 'manager'::app_role)
  OR (
    student_price = (SELECT l.student_price FROM public.lessons l WHERE l.id = lessons.id)
    AND tutor_payout = (SELECT l.tutor_payout FROM public.lessons l WHERE l.id = lessons.id)
    AND student_payment_status = (SELECT l.student_payment_status FROM public.lessons l WHERE l.id = lessons.id)
    AND tutor_payout_status = (SELECT l.tutor_payout_status FROM public.lessons l WHERE l.id = lessons.id)
    AND tutor_id = (SELECT l.tutor_id FROM public.lessons l WHERE l.id = lessons.id)
    AND student_id = (SELECT l.student_id FROM public.lessons l WHERE l.id = lessons.id)
  )
);

-- Defense-in-depth trigger (already exists in code; ensure installed)
DROP TRIGGER IF EXISTS trg_protect_lesson_financials ON public.lessons;
CREATE TRIGGER trg_protect_lesson_financials
BEFORE UPDATE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.protect_lesson_financials();

-- Ensure autofill + payment-date triggers are present
DROP TRIGGER IF EXISTS trg_autofill_lesson_prices ON public.lessons;
CREATE TRIGGER trg_autofill_lesson_prices
BEFORE INSERT ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.autofill_lesson_prices();

DROP TRIGGER IF EXISTS trg_set_payment_dates ON public.lessons;
CREATE TRIGGER trg_set_payment_dates
BEFORE UPDATE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.set_payment_dates();

-- 2) Lock down SELECT on tutor_details with a RESTRICTIVE catch-all
DROP POLICY IF EXISTS "Restrict tutor_details visibility (restrictive)" ON public.tutor_details;
CREATE POLICY "Restrict tutor_details visibility (restrictive)"
ON public.tutor_details
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  OR auth.uid() = user_id
  OR (
    public.has_role(auth.uid(), 'student'::app_role)
    AND (
      EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = tutor_details.user_id AND l.student_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = tutor_details.user_id AND r.student_id = auth.uid())
    )
  )
);
