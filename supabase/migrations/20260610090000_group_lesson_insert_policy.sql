-- Fix: group lessons cannot be created from the dashboard quick menu.
--
-- Root cause: the existing INSERT policies on public.lessons
-- ("Independent tutor creates own-source lessons" and "Tutor creates own lessons")
-- both require a matching public.student_rates row via
--   EXISTS (SELECT 1 FROM student_rates r WHERE r.tutor_id = auth.uid()
--                                           AND r.student_id = lessons.student_id ...)
-- A group lesson is inserted with student_id = NULL (the participants live in
-- lesson_participants instead), so that EXISTS is always false and the row is
-- rejected with "new row violates row-level security policy for table lessons".
--
-- Fix: add a dedicated, permissive INSERT policy that authorises a tutor to
-- create a group lesson they own (student_id IS NULL, group_id owned by them).
-- RLS INSERT policies are OR-combined, so this only *adds* a valid path; the
-- individual-lesson policies are untouched.

DROP POLICY IF EXISTS "Tutor creates own group lessons" ON public.lessons;

CREATE POLICY "Tutor creates own group lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND student_id IS NULL
  AND group_id IS NOT NULL
  AND public.is_group_tutor(group_id, auth.uid())
);

COMMENT ON POLICY "Tutor creates own group lessons" ON public.lessons IS
  'Allows a tutor to create a group lesson they own (student_id NULL, group_id owned by the tutor). Individual-lesson INSERT policies require a student_rates match and cannot cover group lessons.';
