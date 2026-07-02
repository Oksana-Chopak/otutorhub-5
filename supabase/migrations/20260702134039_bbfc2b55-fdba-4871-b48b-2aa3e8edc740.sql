
-- 20260714000000_hub_money_guard_and_group_isolation

-- 1) Harden update_lesson_details_safe: hub tutors cannot write student money.
CREATE OR REPLACE FUNCTION public.update_lesson_details_safe(_lesson_id uuid, _patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tutor          uuid;
  v_source         text;
  v_is_mgr         boolean;
  v_is_tutor_owner boolean;
  v_can_write_student_money boolean;
BEGIN
  IF _lesson_id IS NULL THEN RAISE EXCEPTION 'lesson_id required'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'patch must be a jsonb object'; END IF;

  SELECT tutor_id, source INTO v_tutor, v_source FROM public.lessons WHERE id = _lesson_id;
  IF v_tutor IS NULL THEN RAISE EXCEPTION 'lesson not found'; END IF;

  v_is_mgr         := public.has_role(auth.uid(), 'manager');
  v_is_tutor_owner := (auth.uid() = v_tutor);
  IF NOT (v_is_tutor_owner OR v_is_mgr) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Student money: manager on any lesson, OR the tutor on an independent lesson (they own the money).
  -- A hub tutor MUST NOT be able to write student_price / student_payment_status / student_paid_at:
  -- that's the hub's revenue, not the tutor's.
  v_can_write_student_money := v_is_mgr OR (v_is_tutor_owner AND v_source = 'independent');

  INSERT INTO public.lesson_details (lesson_id) VALUES (_lesson_id)
  ON CONFLICT (lesson_id) DO NOTHING;

  UPDATE public.lesson_details SET
    homework               = CASE WHEN _patch ? 'homework'               THEN NULLIF(_patch->>'homework','')                 ELSE homework END,
    summary                = CASE WHEN _patch ? 'summary'                THEN NULLIF(_patch->>'summary','')                  ELSE summary END,
    student_notes          = CASE WHEN _patch ? 'student_notes'          THEN NULLIF(_patch->>'student_notes','')            ELSE student_notes END,
    student_price          = CASE WHEN v_can_write_student_money AND _patch ? 'student_price'
                                  THEN NULLIF(_patch->>'student_price','')::numeric    ELSE student_price END,
    student_payment_status = CASE WHEN v_can_write_student_money AND _patch ? 'student_payment_status'
                                  THEN NULLIF(_patch->>'student_payment_status','')   ELSE student_payment_status END,
    student_paid_at        = CASE
                               WHEN v_can_write_student_money AND _patch ? 'student_paid_at'
                                 THEN NULLIF(_patch->>'student_paid_at','')::timestamptz
                               WHEN v_can_write_student_money AND _patch ? 'student_payment_status'
                                 THEN CASE WHEN NULLIF(_patch->>'student_payment_status','') = 'paid'
                                           THEN COALESCE(student_paid_at, now())
                                           ELSE NULL END
                               ELSE student_paid_at
                             END,
    tutor_payout           = CASE WHEN v_is_mgr AND _patch ? 'tutor_payout'
                                  THEN NULLIF(_patch->>'tutor_payout','')::numeric ELSE tutor_payout END,
    tutor_payout_status    = CASE WHEN v_is_mgr AND _patch ? 'tutor_payout_status'
                                  THEN NULLIF(_patch->>'tutor_payout_status','') ELSE tutor_payout_status END,
    tutor_paid_at          = CASE
                               WHEN v_is_mgr AND _patch ? 'tutor_payout_status'
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
END $function$;

REVOKE EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) TO authenticated;

-- 2) Group tables: manager must NOT see independent tutors' groups/enrollments/participants.
-- The `is_independent_tutor()` helper checks only the CALLER, so it can't gate a peer's tutor_id;
-- reuse the same inline predicate that the working student_rates P0 fix uses.

-- lesson_groups
DROP POLICY IF EXISTS "Manager manages all groups" ON public.lesson_groups;
CREATE POLICY "Manager manages hub groups only"
  ON public.lesson_groups
  FOR ALL
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (
      SELECT 1 FROM public.tutor_workspace_settings ws
      WHERE ws.tutor_id = lesson_groups.tutor_id AND ws.independent_workspace = true
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (
      SELECT 1 FROM public.tutor_workspace_settings ws
      WHERE ws.tutor_id = lesson_groups.tutor_id AND ws.independent_workspace = true
    )
  );

-- group_enrollments (join through lesson_groups.tutor_id)
DROP POLICY IF EXISTS "Manager manages all enrollments" ON public.group_enrollments;
CREATE POLICY "Manager manages hub enrollments only"
  ON public.group_enrollments
  FOR ALL
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (
      SELECT 1
      FROM public.lesson_groups g
      JOIN public.tutor_workspace_settings ws ON ws.tutor_id = g.tutor_id
      WHERE g.id = group_enrollments.group_id AND ws.independent_workspace = true
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (
      SELECT 1
      FROM public.lesson_groups g
      JOIN public.tutor_workspace_settings ws ON ws.tutor_id = g.tutor_id
      WHERE g.id = group_enrollments.group_id AND ws.independent_workspace = true
    )
  );

-- lesson_participants (join through lessons.tutor_id)
DROP POLICY IF EXISTS "manager_manages_participants" ON public.lesson_participants;
CREATE POLICY "manager_manages_hub_participants_only"
  ON public.lesson_participants
  FOR ALL
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (
      SELECT 1
      FROM public.lessons l
      JOIN public.tutor_workspace_settings ws ON ws.tutor_id = l.tutor_id
      WHERE l.id = lesson_participants.lesson_id AND ws.independent_workspace = true
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role)
    AND NOT EXISTS (
      SELECT 1
      FROM public.lessons l
      JOIN public.tutor_workspace_settings ws ON ws.tutor_id = l.tutor_id
      WHERE l.id = lesson_participants.lesson_id AND ws.independent_workspace = true
    )
  );
