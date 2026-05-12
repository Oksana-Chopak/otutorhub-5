-- Re-scope policies from public (incl. anon) to authenticated role only.

-- lesson_details
ALTER POLICY "lesson_details_tutor_insert" ON public.lesson_details TO authenticated;
ALTER POLICY "lesson_details_tutor_update" ON public.lesson_details TO authenticated;
ALTER POLICY "lesson_details_manager_all"  ON public.lesson_details TO authenticated;

-- group_enrollments
ALTER POLICY "Tutor manages enrollments of own groups" ON public.group_enrollments TO authenticated;

-- lesson_groups
ALTER POLICY "Student views own groups" ON public.lesson_groups TO authenticated;
