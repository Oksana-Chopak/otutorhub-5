-- Security linter: "Tutors can insert lesson_details but cannot update them."
--
-- The tutor INSERT policy lets a tutor write a lesson_details row directly with ANY
-- column values (including tutor_payout / student_price), while UPDATEs are forced
-- through the SECURITY DEFINER whitelist RPC update_lesson_details_safe. That asymmetry
-- is both the linter warning AND a financial-integrity hole (a tutor could self-set
-- payout/price on the initial INSERT).
--
-- Legitimate creation already happens inside update_lesson_details_safe
-- (INSERT INTO lesson_details (lesson_id) ... ON CONFLICT DO NOTHING, SECURITY DEFINER),
-- and a code scan confirms NO client path does a direct lesson_details insert/upsert.
-- So the direct tutor INSERT policy is unnecessary — drop it. Tutors now create AND
-- update lesson_details only through the safe RPC (symmetric, whitelisted).

DROP POLICY IF EXISTS "lesson_details_tutor_insert" ON public.lesson_details;
