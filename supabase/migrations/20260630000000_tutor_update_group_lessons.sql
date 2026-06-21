-- Fix: editing a GROUP lesson from the calendar fails with "Не вдалося зберегти зміни".
--
-- The tutor UPDATE policy "Tutor updates own lessons (non-financial)" keeps tutor_id
-- and student_id immutable via:
--     AND student_id = (SELECT l.student_id FROM lessons l WHERE l.id = lessons.id)
-- For a GROUP lesson student_id IS NULL, so this becomes `NULL = NULL`, which evaluates
-- to NULL (not TRUE) — the WITH CHECK fails and the UPDATE is rejected, even when the
-- tutor only changes subject / time / duration / meeting_url.
--
-- Fix: use NULL-safe `IS NOT DISTINCT FROM` so a NULL (group) student_id still passes
-- the immutability check. Immutability is still enforced (and also by the
-- protect_lesson_fields BEFORE UPDATE trigger). Individual-lesson behavior is unchanged.

DROP POLICY IF EXISTS "Tutor updates own lessons (non-financial)" ON public.lessons;

CREATE POLICY "Tutor updates own lessons (non-financial)"
ON public.lessons
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'tutor'::app_role) AND auth.uid() = tutor_id
)
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
  AND tutor_id   IS NOT DISTINCT FROM (SELECT l.tutor_id   FROM public.lessons l WHERE l.id = lessons.id)
  AND student_id IS NOT DISTINCT FROM (SELECT l.student_id FROM public.lessons l WHERE l.id = lessons.id)
);
