-- ============================================================
-- FIX (P0 data leak): a hub manager could read/download EVERY independent
-- tutor's private lesson files. The June isolation fix (20260523174110) scoped
-- lessons/lesson_details/student_rates to source='hub' OR NULL for managers, but
-- never touched lesson_attachments or the storage policy. Mirror it here.
-- ============================================================

DROP POLICY IF EXISTS "Lesson participants view attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants view attachments"
ON public.lesson_attachments
FOR SELECT
TO authenticated
USING (
  (
    has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.lessons lm
      WHERE lm.id = lesson_attachments.lesson_id
        AND (lm.source = 'hub' OR lm.source IS NULL)
    )
  )
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

DROP POLICY IF EXISTS "Lesson participants read lesson-attachments" ON storage.objects;
CREATE POLICY "Lesson participants read lesson-attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    (
      has_role(auth.uid(), 'manager'::app_role)
      AND EXISTS (
        SELECT 1
        FROM public.lesson_attachments am
        JOIN public.lessons lm ON lm.id = am.lesson_id
        WHERE am.storage_path = storage.objects.name
          AND (lm.source = 'hub' OR lm.source IS NULL)
      )
    )
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
