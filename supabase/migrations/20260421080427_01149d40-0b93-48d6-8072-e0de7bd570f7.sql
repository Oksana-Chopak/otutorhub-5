
-- 1. Remove students' SELECT access to tutor_subject_rates (tutor's payout per subject).
-- Tutor's payout is private financial data between tutor and manager only.
DROP POLICY IF EXISTS "Student views assigned tutor subject rates" ON public.tutor_subject_rates;

-- 2. Remove students' access to assigned tutor details (which exposes rate_per_lesson — tutor's payout).
-- Replace with view that exposes only non-financial fields (subjects, bio).
DROP POLICY IF EXISTS "Student views assigned tutor details" ON public.tutor_details;

-- The remaining restrictive policy "Restrict tutor_details visibility" still allows students,
-- which would re-expose rate_per_lesson. Tighten it: students get no row access to tutor_details.
DROP POLICY IF EXISTS "Restrict tutor_details visibility (restrictive)" ON public.tutor_details;
CREATE POLICY "Restrict tutor_details visibility (restrictive)"
  ON public.tutor_details
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    OR auth.uid() = user_id
  );

-- Public view for students/others to read non-financial tutor info (subjects, bio).
CREATE OR REPLACE VIEW public.tutor_public_details
WITH (security_invoker = on) AS
  SELECT user_id, subjects, bio, created_at, updated_at
  FROM public.tutor_details;

GRANT SELECT ON public.tutor_public_details TO authenticated;

-- 3. Remove tutors' SELECT access to student_rates (student's price — what student pays).
-- Student's price is private between student and manager.
DROP POLICY IF EXISTS "Tutor views own student rates" ON public.student_rates;
