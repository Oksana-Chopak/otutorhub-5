-- Security linter: "Students cannot read their own referral requests after submission."
--
-- The lead-PII hardening dropped the student SELECT policy on tutor_referral_requests
-- entirely, which over-corrected: a student can no longer read the request they just
-- submitted. Re-add a SELECT policy scoped to the student's OWN rows only.
--
-- This is safe: USING (student_id = auth.uid()) returns ONLY the caller's own request
-- (their own contact info), so it does not re-expose other students' leads — the
-- enumeration risk the hardening closed stays closed. The lead-field write guard
-- (guard_tutor_referral_lead_fields) is a write-time trigger and is unaffected.

DROP POLICY IF EXISTS "students read own referral requests" ON public.tutor_referral_requests;

CREATE POLICY "students read own referral requests"
ON public.tutor_referral_requests
FOR SELECT
TO authenticated
USING (student_id = auth.uid());
