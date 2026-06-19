/* ============================================================================
   P0 DATA-ISOLATION — COMPLETE FIX (supersedes 20260523174110 + 20260618000000,
   both of which were ineffective).

   Confirmed prod leak: a PURE hub manager (roles=['manager']) can read every
   independent tutor's lessons + student_rates (private pricing). The pre-release audit
   found THREE compounding root causes the earlier fixes missed:

   1. The broad SELECT policy "lessons_select" (20260506082107) has a manager arm with
      NO source filter and was NEVER dropped — its OR-combined permissive arm grants
      managers SELECT on every lesson. The earlier fixes only dropped the stale name
      "Manager views all lessons" (already renamed to lessons_select) and ADDED another
      permissive policy, which cannot subtract access.
   2. The base "Manager manages student rates" (FOR ALL, 20260418114910) was NEVER
      dropped — same OR-combine leak for rates (read AND write). Earlier fixes dropped a
      non-existent "Manager sees all rates".
   3. 20260618000000 referenced a NON-EXISTENT table public.workspace_settings (correct:
      public.tutor_workspace_settings) -> CREATE POLICY errored -> the whole transaction
      ABORTED -> none of its isolation policies ever applied.

   This migration is timestamped above the latest applied (ordering trap) and is fully
   idempotent (DROP IF EXISTS + CREATE). It rewrites the real live policies so the
   MANAGER arm is hub-scoped (source='hub' OR NULL, and the rate's tutor is not an
   independent workspace), while preserving tutor/student/group access verbatim.
   ============================================================================ */

/* ---------- 1. lessons SELECT: rebuild the single consolidated policy with a
   hub-scoped manager arm; tutor/student/group arms unchanged. ---------- */
DROP POLICY IF EXISTS "lessons_select"                 ON public.lessons;
DROP POLICY IF EXISTS "Manager views all lessons"      ON public.lessons;
DROP POLICY IF EXISTS "Manager views hub lessons only" ON public.lessons;
CREATE POLICY "lessons_select"
ON public.lessons FOR SELECT TO authenticated
USING (
  (public.has_role(auth.uid(), 'manager'::app_role) AND (source = 'hub' OR source IS NULL))
  OR auth.uid() = tutor_id
  OR auth.uid() = student_id
  OR (
    lesson_type IN ('pair', 'group')
    AND group_id IS NOT NULL
    AND public.is_group_active_student(group_id, auth.uid())
  )
);

/* ---------- 1b. lessons manager WRITE: hub-scoped INSERT/UPDATE/DELETE
   (drop both the broad and the never-applied scoped names). ---------- */
DROP POLICY IF EXISTS "Manager creates any lessons" ON public.lessons;
DROP POLICY IF EXISTS "Manager creates any lesson"  ON public.lessons;
DROP POLICY IF EXISTS "Manager creates hub lessons" ON public.lessons;
CREATE POLICY "Manager creates hub lessons"
ON public.lessons FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "Manager updates any lesson"  ON public.lessons;
DROP POLICY IF EXISTS "Manager updates any lessons" ON public.lessons;
DROP POLICY IF EXISTS "Manager updates hub lessons" ON public.lessons;
CREATE POLICY "Manager updates hub lessons"
ON public.lessons FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL))
WITH CHECK (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL));

DROP POLICY IF EXISTS "Manager deletes any lesson"  ON public.lessons;
DROP POLICY IF EXISTS "Manager deletes any lessons" ON public.lessons;
DROP POLICY IF EXISTS "Manager deletes hub lessons" ON public.lessons;
CREATE POLICY "Manager deletes hub lessons"
ON public.lessons FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'manager') AND (source = 'hub' OR source IS NULL));

/* ---------- 2. lesson_details: manager access only via a HUB parent lesson. ---------- */
DROP POLICY IF EXISTS "lesson_details_manager_all"      ON public.lesson_details;
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

/* ---------- 3. student_rates: replace the broad FOR ALL with a hub-scoped FOR ALL
   (covers SELECT + INSERT + UPDATE + DELETE for managers, hub rates only). Dual guard:
   exclude rows whose source='independent' OR whose tutor's workspace is independent.
   NOTE the table-name fix: public.tutor_workspace_settings (NOT workspace_settings). ---------- */
DROP POLICY IF EXISTS "Manager manages student rates"  ON public.student_rates;
DROP POLICY IF EXISTS "Manager sees all rates"         ON public.student_rates;
DROP POLICY IF EXISTS "Manager sees hub rates only"    ON public.student_rates;
DROP POLICY IF EXISTS "Manager manages hub rates only" ON public.student_rates;
CREATE POLICY "Manager manages hub rates only"
ON public.student_rates FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND student_rates.source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
  AND student_rates.source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
);

/* ---------- 4. lesson_attachments + storage: mirror the source scoping for managers,
   keep tutor/student/group access. ---------- */
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
