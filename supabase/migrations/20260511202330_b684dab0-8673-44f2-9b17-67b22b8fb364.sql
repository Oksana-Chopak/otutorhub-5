
-- 1) Allow group/pair lesson participants to view & upload lesson_attachments
DROP POLICY IF EXISTS "Lesson participants view attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants view attachments"
ON public.lesson_attachments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_attachments.lesson_id
      AND (
        auth.uid() = l.tutor_id
        OR auth.uid() = l.student_id
        OR (
          l.group_id IS NOT NULL
          AND public.is_group_active_student(l.group_id, auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM public.lesson_participants lp
          WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "Lesson participants add attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants add attachments"
ON public.lesson_attachments
FOR INSERT
TO authenticated
WITH CHECK (
  uploader_id = auth.uid()
  AND (
    has_role(auth.uid(), 'manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_attachments.lesson_id
        AND (
          auth.uid() = l.tutor_id
          OR auth.uid() = l.student_id
          OR (
            l.group_id IS NOT NULL
            AND public.is_group_active_student(l.group_id, auth.uid())
          )
          OR EXISTS (
            SELECT 1 FROM public.lesson_participants lp
            WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
          )
        )
    )
  )
);

-- 2) Mirror in storage policies for the lesson-attachments bucket
DROP POLICY IF EXISTS "Lesson participants read lesson-attachments" ON storage.objects;
CREATE POLICY "Lesson participants read lesson-attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    has_role(auth.uid(), 'manager'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.lesson_attachments a
      JOIN public.lessons l ON l.id = a.lesson_id
      WHERE a.storage_path = storage.objects.name
        AND (
          auth.uid() = l.tutor_id
          OR auth.uid() = l.student_id
          OR (
            l.group_id IS NOT NULL
            AND public.is_group_active_student(l.group_id, auth.uid())
          )
          OR EXISTS (
            SELECT 1 FROM public.lesson_participants lp
            WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
          )
        )
    )
  )
);

-- 3) Harden is_independent_tutor: refuse to evaluate for users other than the caller
CREATE OR REPLACE FUNCTION public.is_independent_tutor(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow checking the caller's own status (or service_role / no-auth contexts e.g. triggers)
  IF auth.uid() IS NOT NULL AND _user_id <> auth.uid() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'tutor'::app_role
      AND COALESCE(ur.is_independent, false) = true
  );
EXCEPTION WHEN undefined_column THEN
  -- Fallback when is_independent column doesn't exist on user_roles
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'tutor'::app_role
  );
END;
$$;
