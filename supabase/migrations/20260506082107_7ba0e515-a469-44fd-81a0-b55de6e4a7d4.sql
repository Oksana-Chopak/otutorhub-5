DROP POLICY IF EXISTS "Manager views all lessons" ON public.lessons;
DROP POLICY IF EXISTS "Tutor views own lessons" ON public.lessons;
DROP POLICY IF EXISTS "Student views own lessons" ON public.lessons;
DROP POLICY IF EXISTS "Student views group lessons" ON public.lessons;

CREATE POLICY "lessons_select"
ON public.lessons FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  OR auth.uid() = tutor_id
  OR auth.uid() = student_id
  OR (
    lesson_type IN ('pair', 'group')
    AND group_id IS NOT NULL
    AND public.is_group_active_student(group_id, auth.uid())
  )
);