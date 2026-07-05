/* ============================================================================
   mark_tutor_payouts_paid: pay CONDUCTED lessons only (audit MED).

   The manager's payout-day action flipped EVERY unpaid lesson_details row for
   the tutor (only cancelled excluded) — including next week's freshly scheduled
   lessons, which are born 'unpaid'. A lesson scheduled after the payout was
   marked would silently ship as already «paid out» before it was ever taught.

   Fix: restrict the flip to lessons that actually happened — completed, or
   scheduled with starts_at in the past (same shape as the shared frontend
   billable predicate). Pending lessons never pay out.

   The frontend payout-day sum (DashboardPage smart task) applies the same
   filter, so the number shown equals the number the RPC pays.

   Idempotent (CREATE OR REPLACE). Timestamp strictly above 20260721000000.
   ============================================================================ */

CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can mark payouts';
  END IF;
  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid', tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id AND l.tutor_id = _tutor_id
    AND COALESCE(ld.tutor_payout_status,'unpaid') = 'unpaid'
    AND l.status <> 'cancelled'
    AND l.status <> 'pending'
    -- conducted only: completed, or already started — never future bookings
    AND (l.status = 'completed' OR l.starts_at <= now());
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.tutor_details SET payout_last_marked_at = now() WHERE user_id = _tutor_id;
  RETURN _n;
END; $$;

REVOKE EXECUTE ON FUNCTION public.mark_tutor_payouts_paid(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_tutor_payouts_paid(uuid) TO authenticated;
