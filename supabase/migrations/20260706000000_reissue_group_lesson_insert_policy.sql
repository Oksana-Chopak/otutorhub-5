-- CRITICAL: creating a GROUP lesson fails with "new row violates row-level security
-- policy for table lessons".
--
-- Root cause (verified): the permissive INSERT policy "Tutor creates own group lessons"
-- was originally added in 20260610090000 — a timestamp BELOW the live high-water mark, so
-- Supabase's migration runner SILENTLY SKIPPED it (the documented ordering trap). It was
-- never dropped by a later migration, and there is no RESTRICTIVE policy on lessons, so
-- it simply does not exist live. A group lesson has student_id = NULL; the individual
-- INSERT policies ("Tutor creates own lessons" / "Independent tutor creates own-source
-- lessons") require a matching student_rates row for lessons.student_id, which is always
-- false for NULL — so with this group policy absent, NOTHING authorises a group insert.
--
-- is_group_tutor(group_id, auth.uid()) is correct (returns true for the tutor's own group),
-- and all other predicate columns (tutor_id/created_by = auth.uid(), student_id NULL,
-- group_id NOT NULL) are satisfied by createGroupLesson. So re-issuing the IDENTICAL
-- policy with a high timestamp (guaranteed to apply) is the fix. Idempotent DROP + CREATE.

DROP POLICY IF EXISTS "Tutor creates own group lessons" ON public.lessons;

CREATE POLICY "Tutor creates own group lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND student_id IS NULL
  AND group_id IS NOT NULL
  AND public.is_group_tutor(group_id, auth.uid())
);
