-- ============================================================
-- P0 DATA-ISOLATION ENFORCEMENT (idempotent, supersedes 20260523174110)
--
-- Proven leak in prod (2026-06-18): a PURE manager account
-- (roles = ['manager'], no tutor role) could read:
--   • an independent tutor's lesson  (source='independent', tutor/student/creator all another user)
--   • 3 independent tutors' student_rates (private pricing)
-- => the May-23 isolation migration was never effective in prod.
--
-- This migration re-asserts every manager policy with source-based
-- scoping so hub managers see ONLY hub data (source='hub' OR NULL).
-- Every statement is DROP IF EXISTS + CREATE => safe to apply repeatedly,
-- regardless of which (if any) prior isolation policy is currently live.
-- ============================================================

-- ---------- 1. lessons: manager sees/creates/updates/deletes HUB lessons only ----------
DROP POLICY IF EXISTS "Manager views all lessons" ON public.lessons;
DROP POLICY IF EXISTS "Manager views hub lessons only" ON public.lessons;
CREATE POLICY "Manager views hub lessons only"
ON public.lessons FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

DROP POLICY IF EXISTS "Manager creates any lesson" ON public.lessons;
DROP POLICY IF EXISTS "Manager creates hub lessons" ON public.lessons;
CREATE POLICY "Manager creates hub lessons"
ON public.lessons FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

DROP POLICY IF EXISTS "Manager updates any lesson" ON public.lessons;
DROP POLICY IF EXISTS "Manager updates hub lessons" ON public.lessons;
CREATE POLICY "Manager updates hub lessons"
ON public.lessons FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
)
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

DROP POLICY IF EXISTS "Manager deletes any lesson" ON public.lessons;
DROP POLICY IF EXISTS "Manager deletes hub lessons" ON public.lessons;
CREATE POLICY "Manager deletes hub lessons"
ON public.lessons FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

-- ---------- 2. lesson_details: manager only via a HUB parent lesson ----------
DROP POLICY IF EXISTS "lesson_details_manager_all" ON public.lesson_details;
DROP POLICY IF EXISTS "lesson_details_manager_hub_only" ON public.lesson_details;
CREATE POLICY "lesson_details_manager_hub_only"
ON public.lesson_details FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id
      AND public.has_role(auth.uid(), 'manager')
      AND (l.source = 'hub' OR l.source IS NULL)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_details.lesson_id
      AND public.has_role(auth.uid(), 'manager')
      AND (l.source = 'hub' OR l.source IS NULL)
  )
);

-- ---------- 3. student_rates: manager hidden from ANY independent rate ----------
-- Robust dual guard: hide if the rate's source is 'independent' OR the tutor's
-- workspace is independent. (The old policy keyed ONLY off workspace_settings,
-- so an independent rate whose tutor lacked that flag still leaked.)
DROP POLICY IF EXISTS "Manager sees all rates" ON public.student_rates;
DROP POLICY IF EXISTS "Manager sees hub rates only" ON public.student_rates;
CREATE POLICY "Manager sees hub rates only"
ON public.student_rates FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND student_rates.source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
);

-- ---------- 4. lesson_attachments + storage: mirror the source scoping ----------
DROP POLICY IF EXISTS "Lesson participants view attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants view attachments"
ON public.lesson_attachments FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'manager'::app_role)
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
        OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.lesson_participants lp
          WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "Lesson participants read lesson-attachments" ON storage.objects;
CREATE POLICY "Lesson participants read lesson-attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    (
      public.has_role(auth.uid(), 'manager'::app_role)
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
          OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
          OR EXISTS (
            SELECT 1 FROM public.lesson_participants lp
            WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
          )
        )
    )
  )
);

COMMENT ON POLICY "Manager views hub lessons only" ON public.lessons IS
  'P0 isolation: hub managers see ONLY source=hub/NULL lessons. Independent tutor data is private. Re-asserted 2026-06-18 after prod leak.';
