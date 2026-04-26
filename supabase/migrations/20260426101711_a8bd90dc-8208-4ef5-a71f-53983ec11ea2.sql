-- Allow tutors to SELECT their own student_rates rows (covers non-independent/hub tutors too).
-- Existing policies only let independent tutors manage their own rates and students see their own rates;
-- non-independent (hub) tutors had no SELECT policy on their own rate rows.
CREATE POLICY "Tutor views own student rates"
ON public.student_rates
FOR SELECT
TO authenticated
USING (auth.uid() = tutor_id);