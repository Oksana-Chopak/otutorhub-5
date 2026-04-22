-- Tutor INSERT: require existing manager-approved relationship via student_rates
DROP POLICY IF EXISTS "Tutor creates own lessons with default financials" ON public.lessons;

CREATE POLICY "Tutor creates own lessons with default financials"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id   = auth.uid()
  AND created_by = auth.uid()
  AND student_price = 0::numeric
  AND tutor_payout  = 0::numeric
  AND student_payment_status = 'unpaid'::payment_status
  AND tutor_payout_status    = 'unpaid'::payment_status
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid() AND r.student_id = lessons.student_id
  )
);

-- Student INSERT (default lessons): require existing manager-approved relationship
DROP POLICY IF EXISTS "Student creates own lessons with default financials" ON public.lessons;

CREATE POLICY "Student creates own lessons with default financials"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'student'::app_role)
  AND student_id = auth.uid()
  AND created_by = auth.uid()
  AND student_price = 0::numeric
  AND tutor_payout  = 0::numeric
  AND student_payment_status = 'unpaid'::payment_status
  AND tutor_payout_status    = 'unpaid'::payment_status
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = lessons.tutor_id AND r.student_id = auth.uid()
  )
);

-- Student lesson REQUEST (pending status): same relationship requirement
DROP POLICY IF EXISTS "Student requests lesson" ON public.lessons;

CREATE POLICY "Student requests lesson"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'student'::app_role)
  AND auth.uid() = student_id
  AND auth.uid() = created_by
  AND status = 'pending'::lesson_status
  AND student_payment_status = 'unpaid'::payment_status
  AND tutor_payout_status    = 'unpaid'::payment_status
  AND student_price = 0::numeric
  AND tutor_payout  = 0::numeric
  AND EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = lessons.tutor_id AND r.student_id = auth.uid()
  )
);