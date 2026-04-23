-- Drop old restrictive policies that conflict with autofill_lesson_prices trigger
DROP POLICY IF EXISTS "Student requests lesson" ON public.lessons;
DROP POLICY IF EXISTS "Student creates own lessons with default financials" ON public.lessons;
DROP POLICY IF EXISTS "Tutor creates own lessons with default financials" ON public.lessons;
DROP POLICY IF EXISTS "Independent tutor creates own-source lessons" ON public.lessons;

-- Student can request a lesson (financials auto-filled by trigger)
CREATE POLICY "Student requests lesson"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'student'::app_role)
  AND auth.uid() = student_id
  AND auth.uid() = created_by
  AND status = 'pending'::lesson_status
  AND student_payment_status = 'unpaid'::payment_status
  AND tutor_payout_status = 'unpaid'::payment_status
  AND EXISTS (
    SELECT 1 FROM student_rates r
    WHERE r.tutor_id = lessons.tutor_id AND r.student_id = auth.uid()
  )
);

-- Tutor creates own lessons (financials auto-filled by trigger)
CREATE POLICY "Tutor creates own lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND student_payment_status = 'unpaid'::payment_status
  AND tutor_payout_status = 'unpaid'::payment_status
  AND EXISTS (
    SELECT 1 FROM student_rates r
    WHERE r.tutor_id = auth.uid() AND r.student_id = lessons.student_id
  )
);

-- Independent tutor creates own-source lessons
CREATE POLICY "Independent tutor creates own-source lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND source = 'independent'::text
  AND is_independent_tutor(auth.uid())
  AND student_payment_status = 'unpaid'::payment_status
  AND tutor_payout_status = 'unpaid'::payment_status
  AND EXISTS (
    SELECT 1 FROM student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = lessons.student_id
      AND r.source = 'independent'::text
  )
);