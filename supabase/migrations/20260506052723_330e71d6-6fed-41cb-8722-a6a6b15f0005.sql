
-- Break recursion between lesson_groups <-> group_enrollments by using SECURITY DEFINER helpers

CREATE OR REPLACE FUNCTION public.is_group_tutor(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lesson_groups g
    WHERE g.id = _group_id AND g.tutor_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_active_student(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_enrollments ge
    WHERE ge.group_id = _group_id
      AND ge.student_id = _user_id
      AND ge.status = 'active'
  );
$$;

-- Replace recursive policies on group_enrollments
DROP POLICY IF EXISTS "Tutor manages enrollments of own groups" ON public.group_enrollments;
CREATE POLICY "Tutor manages enrollments of own groups"
ON public.group_enrollments
FOR ALL
USING (public.is_group_tutor(group_id, auth.uid()))
WITH CHECK (public.is_group_tutor(group_id, auth.uid()));

-- Replace recursive policy on lesson_groups
DROP POLICY IF EXISTS "Student views own groups" ON public.lesson_groups;
CREATE POLICY "Student views own groups"
ON public.lesson_groups
FOR SELECT
USING (public.is_group_active_student(id, auth.uid()));

-- Replace recursive policy on lessons (group lessons visibility for students)
DROP POLICY IF EXISTS "Student views group lessons" ON public.lessons;
CREATE POLICY "Student views group lessons"
ON public.lessons
FOR SELECT
USING (
  lesson_type = ANY (ARRAY['pair'::lesson_type, 'group'::lesson_type])
  AND group_id IS NOT NULL
  AND public.is_group_active_student(group_id, auth.uid())
);
