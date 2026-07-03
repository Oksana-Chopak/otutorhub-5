/* ============================================================================
   GROUP hub-money lockdown, part 1 of 2 — WRITE GATE (audit HIGH, MON-2).

   20260714/20260715 closed the hub-margin breach for INDIVIDUAL lessons
   (lesson_details) but the GROUP path stayed open: a hub tutor could directly
   UPDATE lesson_participants.student_payment_status/student_paid_at (mark hub
   debts paid) and group_enrollments.price_per_lesson (rewrite the hub's
   per-student group price) — the policies `tutor_manages_participants` and
   `Tutor manages enrollments of own groups` are FOR ALL with no money scoping.

   This migration locks the money columns behind SECURITY DEFINER RPCs gated the
   same way as update_lesson_details_safe: hub-scoped manager OR independent
   owner-tutor. Attendance/status columns stay directly writable (RLS unchanged).
   Part 2 (read masking via a definer view) ships next.

   Idempotent. Timestamp strictly above 20260718000000.
   ============================================================================ */

/* ── (1) Per-participant payment marking ──────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.set_group_participant_payment(_participant_ids uuid[], _status text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_mgr boolean;
  _n integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _status NOT IN ('paid', 'unpaid') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _participant_ids IS NULL OR array_length(_participant_ids, 1) IS NULL THEN RETURN 0; END IF;

  _is_mgr := public.has_role(_uid, 'manager'::app_role);

  UPDATE public.lesson_participants lp
     SET student_payment_status = _status,
         student_paid_at        = CASE WHEN _status = 'paid' THEN now() ELSE NULL END
    FROM public.lessons l
   WHERE lp.id = ANY(_participant_ids)
     AND l.id = lp.lesson_id
     AND (
       /* hub money → hub-scoped manager only */
       (_is_mgr AND (l.source = 'hub' OR l.source IS NULL))
       /* independent money → the owning independent tutor */
       OR (
         l.tutor_id = _uid
         AND l.source = 'independent'
         AND EXISTS (
           SELECT 1 FROM public.tutor_workspace_settings ws
           WHERE ws.tutor_id = _uid AND ws.independent_workspace = true
         )
       )
     );
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.set_group_participant_payment(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_participant_payment(uuid[], text) TO authenticated;

/* ── (2) Per-enrollment group price ───────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.set_group_enrollment_price(_enrollment_id uuid, _price numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_mgr boolean;
  _group_tutor uuid;
  _tutor_independent boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _price IS NULL OR _price < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;

  SELECT g.tutor_id INTO _group_tutor
  FROM public.group_enrollments e
  JOIN public.lesson_groups g ON g.id = e.group_id
  WHERE e.id = _enrollment_id;
  IF _group_tutor IS NULL THEN RAISE EXCEPTION 'Enrollment not found'; END IF;

  _is_mgr := public.has_role(_uid, 'manager'::app_role);
  _tutor_independent := EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = _group_tutor AND ws.independent_workspace = true
  );

  IF NOT (
    (_is_mgr AND NOT _tutor_independent)              /* hub group → manager */
    OR (_uid = _group_tutor AND _tutor_independent)   /* independent group → owner */
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.group_enrollments
     SET price_per_lesson = _price
   WHERE id = _enrollment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_group_enrollment_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_enrollment_price(uuid, numeric) TO authenticated;

/* ── (3) Column-level write locks (defense-in-depth under the RLS policies) ──
   All app users share the `authenticated` role, so the direct money writes the
   FOR ALL policies allowed are now closed for everyone; legitimate writes go
   through the two RPCs above (or service role). Non-money columns stay open. */
REVOKE UPDATE ON public.lesson_participants FROM authenticated;
GRANT  UPDATE (attendance_status) ON public.lesson_participants TO authenticated;

REVOKE UPDATE ON public.group_enrollments FROM authenticated;
GRANT  UPDATE (status) ON public.group_enrollments TO authenticated;