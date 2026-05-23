-- ============================================================
-- Fix: Manager should NOT see lessons from independent tutors
--
-- Problem: "Manager views all lessons" RLS policy returns ALL
-- lessons including source='independent' (private tutor data).
-- Independent tutors' lessons, finances, students are private
-- to them — the hub manager has no business seeing this.
-- ============================================================

-- 1. Fix lessons table RLS — manager only sees hub lessons
DROP POLICY IF EXISTS "Manager views all lessons" ON public.lessons;

CREATE POLICY "Manager views hub lessons only"
ON public.lessons FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

-- 2. Fix lesson_details — manager only sees hub lesson details
DROP POLICY IF EXISTS "lesson_details_manager_all" ON public.lesson_details;

CREATE POLICY "lesson_details_manager_hub_only"
ON public.lesson_details
FOR ALL
TO authenticated
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

-- 3. Fix manager CREATE/UPDATE/DELETE — only hub lessons
DROP POLICY IF EXISTS "Manager creates any lesson" ON public.lessons;
CREATE POLICY "Manager creates hub lessons"
ON public.lessons FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

DROP POLICY IF EXISTS "Manager updates any lesson" ON public.lessons;
CREATE POLICY "Manager updates hub lessons"
ON public.lessons FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
)
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

DROP POLICY IF EXISTS "Manager deletes any lesson" ON public.lessons;
CREATE POLICY "Manager deletes hub lessons"
ON public.lessons FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND (source = 'hub' OR source IS NULL)
);

-- 4. Fix profiles visibility — manager should not see
-- independent tutors' private student profiles
-- (profiles table is typically open for authenticated users,
-- but we should ensure independent tutor's students don't
-- appear in manager's PeoplePage student list)
-- This is handled at the application level (see frontend fix below)

-- 5. Fix student_rates — manager should not see independent rates
DROP POLICY IF EXISTS "Manager sees all rates" ON public.student_rates;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'student_rates'
      AND policyname = 'Manager sees all rates'
  ) THEN
    EXECUTE 'DROP POLICY "Manager sees all rates" ON public.student_rates';
  END IF;
END $$;

-- Recreate if it existed
CREATE POLICY "Manager sees hub rates only"
ON public.student_rates FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND NOT EXISTS (
    SELECT 1 FROM public.workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
);

COMMENT ON POLICY "Manager views hub lessons only" ON public.lessons IS
  'Hub managers can only see lessons created within the hub (source=hub or null). Independent tutor lessons (source=independent) are private.';
