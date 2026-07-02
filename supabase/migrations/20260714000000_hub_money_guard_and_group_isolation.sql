-- ============================================================================
-- Hub money-privacy hardening (audit P0 cluster) — two independent fixes:
--
-- A) update_lesson_details_safe WRITE-gate: a HUB tutor must never write the
--    student money columns (student_price / student_payment_status / student_paid_at)
--    — that's the manager's to record (student→hub). The prior version only gated the
--    payout columns to managers; the student columns were applied for ANY tutor, so a
--    hub tutor (who IS the lesson's tutor) could mark a student's debt-to-hub paid or
--    alter the price. Now the student columns apply ONLY when the caller is a manager on
--    a HUB lesson, OR the caller owns an INDEPENDENT lesson (their own money). Payout
--    columns apply only to a manager on a hub lesson. Everything else (homework/summary/
--    fireflies) is unchanged, so a hub tutor keeps their legitimate writes.
--
-- B) P0 group-table isolation: 20260621000000 hub-scoped lessons/lesson_details/
--    student_rates but MISSED the three group tables. A pure hub manager could read
--    independent tutors' lesson_groups / group_enrollments / lesson_participants
--    (student ids + private per-student pricing). This hub-scopes the three MANAGER
--    policies exactly like the P0 fix (independent tutor's groups excluded); the
--    tutor/student arms are left verbatim.
--
-- Idempotent (CREATE OR REPLACE + DROP/CREATE). Timestamp is above 20260713000000
-- (the latest applied) to avoid the ordering-skip trap.
-- ============================================================================

-- ── A) update_lesson_details_safe: gate the student money columns ────────────
CREATE OR REPLACE FUNCTION public.update_lesson_details_safe(_lesson_id uuid, _patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tutor      uuid;
  v_source     text;
  v_is_mgr     boolean;
  v_mgr_hub    boolean;   -- manager acting on a hub lesson
  v_student_ok boolean;   -- may write student money columns
BEGIN
  IF _lesson_id IS NULL THEN RAISE EXCEPTION 'lesson_id required'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'patch must be a jsonb object'; END IF;

  SELECT tutor_id, source INTO v_tutor, v_source FROM public.lessons WHERE id = _lesson_id;
  IF v_tutor IS NULL THEN RAISE EXCEPTION 'lesson not found'; END IF;

  v_is_mgr     := public.has_role(auth.uid(), 'manager');
  IF NOT (auth.uid() = v_tutor OR v_is_mgr) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_mgr_hub    := v_is_mgr AND (v_source = 'hub' OR v_source IS NULL);
  -- Student money is the MANAGER's on hub lessons; on independent lessons it is the
  -- owning tutor's. A hub tutor can NEVER write it.
  v_student_ok := v_mgr_hub OR (v_source = 'independent' AND auth.uid() = v_tutor);

  INSERT INTO public.lesson_details (lesson_id) VALUES (_lesson_id)
  ON CONFLICT (lesson_id) DO NOTHING;

  UPDATE public.lesson_details SET
    homework               = CASE WHEN _patch ? 'homework'               THEN NULLIF(_patch->>'homework','')                 ELSE homework END,
    summary                = CASE WHEN _patch ? 'summary'                THEN NULLIF(_patch->>'summary','')                  ELSE summary END,
    student_notes          = CASE WHEN _patch ? 'student_notes'          THEN NULLIF(_patch->>'student_notes','')            ELSE student_notes END,
    -- Student money columns — only manager-on-hub or independent-owner.
    student_price          = CASE WHEN v_student_ok AND _patch ? 'student_price'
                                  THEN NULLIF(_patch->>'student_price','')::numeric ELSE student_price END,
    student_payment_status = CASE WHEN v_student_ok AND _patch ? 'student_payment_status'
                                  THEN NULLIF(_patch->>'student_payment_status','') ELSE student_payment_status END,
    student_paid_at        = CASE
                               WHEN v_student_ok AND _patch ? 'student_paid_at'
                                 THEN NULLIF(_patch->>'student_paid_at','')::timestamptz
                               WHEN v_student_ok AND _patch ? 'student_payment_status'
                                 THEN CASE WHEN NULLIF(_patch->>'student_payment_status','') = 'paid'
                                           THEN COALESCE(student_paid_at, now())
                                           ELSE NULL END
                               ELSE student_paid_at
                             END,
    -- Payout columns — only a manager on a hub lesson.
    tutor_payout           = CASE WHEN v_mgr_hub AND _patch ? 'tutor_payout'
                                  THEN NULLIF(_patch->>'tutor_payout','')::numeric ELSE tutor_payout END,
    tutor_payout_status    = CASE WHEN v_mgr_hub AND _patch ? 'tutor_payout_status'
                                  THEN NULLIF(_patch->>'tutor_payout_status','') ELSE tutor_payout_status END,
    tutor_paid_at          = CASE
                               WHEN v_mgr_hub AND _patch ? 'tutor_payout_status'
                                 THEN CASE WHEN NULLIF(_patch->>'tutor_payout_status','') = 'paid'
                                           THEN COALESCE(tutor_paid_at, now())
                                           ELSE NULL END
                               ELSE tutor_paid_at
                             END,
    fireflies_meeting_id   = CASE WHEN _patch ? 'fireflies_meeting_id'   THEN NULLIF(_patch->>'fireflies_meeting_id','')     ELSE fireflies_meeting_id END,
    fireflies_requested_at = CASE WHEN _patch ? 'fireflies_requested_at' THEN NULLIF(_patch->>'fireflies_requested_at','')::timestamptz ELSE fireflies_requested_at END,
    fireflies_status       = CASE WHEN _patch ? 'fireflies_status'       THEN NULLIF(_patch->>'fireflies_status','')         ELSE fireflies_status END,
    updated_at             = now()
  WHERE lesson_id = _lesson_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) TO authenticated;

-- ── B) Group-table isolation: hub-scope the three MANAGER policies ───────────
-- lesson_groups: manager sees/manages only groups owned by a HUB (non-independent) tutor.
-- Uses the SAME inline predicate the shipped P0 student_rates fix uses (20260621000000):
-- `NOT EXISTS (... tutor_workspace_settings.independent_workspace = true)`. NOTE: do NOT
-- use is_independent_tutor(tutor_id) here — that helper returns true only when its arg
-- equals auth.uid() (a "am I independent" check), so for a manager it's always false.
DROP POLICY IF EXISTS "Manager manages all groups"      ON public.lesson_groups;
DROP POLICY IF EXISTS "Manager manages hub groups only" ON public.lesson_groups;
CREATE POLICY "Manager manages hub groups only" ON public.lesson_groups
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                    WHERE ws.tutor_id = lesson_groups.tutor_id AND ws.independent_workspace = true)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                    WHERE ws.tutor_id = lesson_groups.tutor_id AND ws.independent_workspace = true)
  );

-- group_enrollments: scope via the parent group's tutor (same inline predicate).
DROP POLICY IF EXISTS "Manager manages all enrollments"      ON public.group_enrollments;
DROP POLICY IF EXISTS "Manager manages hub enrollments only" ON public.group_enrollments;
CREATE POLICY "Manager manages hub enrollments only" ON public.group_enrollments
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.lesson_groups g
      WHERE g.id = group_enrollments.group_id
        AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.lesson_groups g
      WHERE g.id = group_enrollments.group_id
        AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                        WHERE ws.tutor_id = g.tutor_id AND ws.independent_workspace = true)
    )
  );

-- lesson_participants: scope via the parent lesson source (hub / NULL), matching P0.
DROP POLICY IF EXISTS "manager_manages_participants"          ON public.lesson_participants;
DROP POLICY IF EXISTS "manager_manages_hub_participants_only" ON public.lesson_participants;
CREATE POLICY "manager_manages_hub_participants_only" ON public.lesson_participants
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (SELECT 1 FROM public.lessons l
                WHERE l.id = lesson_participants.lesson_id AND (l.source = 'hub' OR l.source IS NULL))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (SELECT 1 FROM public.lessons l
                WHERE l.id = lesson_participants.lesson_id AND (l.source = 'hub' OR l.source IS NULL))
  );
