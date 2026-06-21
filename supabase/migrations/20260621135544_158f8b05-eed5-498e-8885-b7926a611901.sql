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