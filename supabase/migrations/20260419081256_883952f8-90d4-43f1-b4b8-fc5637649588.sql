-- Remove the overly broad SELECT policy
DROP POLICY IF EXISTS "Authenticated views tutor directory rows" ON public.tutor_details;

-- Re-add the student-assigned policy that was dropped during the previous migration
CREATE POLICY "Student views assigned tutor details"
ON public.tutor_details
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'student'::app_role)
  AND (
    EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = tutor_details.user_id AND l.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = tutor_details.user_id AND r.student_id = auth.uid())
  )
);

-- Drop the now-unnecessary view
DROP VIEW IF EXISTS public.tutor_directory;