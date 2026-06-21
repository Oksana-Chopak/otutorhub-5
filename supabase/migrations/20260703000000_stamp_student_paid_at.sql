-- P0: "Marked a lesson paid → it disappeared from Debts and showed up NOWHERE."
--
-- Root cause: update_lesson_details_safe writes only the keys present in the patch and
-- does NOT stamp student_paid_at. Callers that mark a payment pass only
-- { student_payment_status: 'paid' } (FinancesPage.writeStudentPayment, bulkMark, the
-- independent "mark all", PendingPaymentsCard.markPaid). An inline comment claimed a DB
-- trigger sets student_paid_at — there is NONE. So the row becomes paid with
-- student_paid_at = NULL: it leaves the Debts list but has no paid date, so paid-date
-- columns/sorts/period logic drop it and it appears in no income/history view.
-- (DashboardPage.updatePayment DID pass student_paid_at, so the same action behaved
-- differently per screen — the inconsistency the owner hit.)
--
-- Fix (server-side, so EVERY caller is corrected at once, symmetric with the payout RPC
-- set_lesson_tutor_payout_status which already stamps tutor_paid_at): derive
-- student_paid_at from the status transition unless the caller passed it explicitly —
-- paid ⇒ keep existing or now(); unpaid/other ⇒ NULL. Everything else is unchanged.

CREATE OR REPLACE FUNCTION public.update_lesson_details_safe(_lesson_id uuid, _patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tutor uuid;
BEGIN
  IF _lesson_id IS NULL THEN RAISE EXCEPTION 'lesson_id required'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'patch must be a jsonb object'; END IF;

  SELECT tutor_id INTO v_tutor FROM public.lessons WHERE id = _lesson_id;
  IF v_tutor IS NULL THEN RAISE EXCEPTION 'lesson not found'; END IF;

  IF NOT (auth.uid() = v_tutor OR public.has_role(auth.uid(), 'manager')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.lesson_details (lesson_id) VALUES (_lesson_id)
  ON CONFLICT (lesson_id) DO NOTHING;

  UPDATE public.lesson_details SET
    homework               = CASE WHEN _patch ? 'homework'               THEN NULLIF(_patch->>'homework','')                 ELSE homework END,
    summary                = CASE WHEN _patch ? 'summary'                THEN NULLIF(_patch->>'summary','')                  ELSE summary END,
    student_notes          = CASE WHEN _patch ? 'student_notes'          THEN NULLIF(_patch->>'student_notes','')            ELSE student_notes END,
    student_price          = CASE WHEN _patch ? 'student_price'          THEN NULLIF(_patch->>'student_price','')::numeric    ELSE student_price END,
    student_payment_status = CASE WHEN _patch ? 'student_payment_status' THEN NULLIF(_patch->>'student_payment_status','')   ELSE student_payment_status END,
    -- Auto-stamp the paid date from the status transition (unless caller passed it).
    student_paid_at        = CASE
                               WHEN _patch ? 'student_paid_at'
                                 THEN NULLIF(_patch->>'student_paid_at','')::timestamptz
                               WHEN _patch ? 'student_payment_status'
                                 THEN CASE WHEN NULLIF(_patch->>'student_payment_status','') = 'paid'
                                           THEN COALESCE(student_paid_at, now())
                                           ELSE NULL END
                               ELSE student_paid_at
                             END,
    fireflies_meeting_id   = CASE WHEN _patch ? 'fireflies_meeting_id'   THEN NULLIF(_patch->>'fireflies_meeting_id','')     ELSE fireflies_meeting_id END,
    fireflies_requested_at = CASE WHEN _patch ? 'fireflies_requested_at' THEN NULLIF(_patch->>'fireflies_requested_at','')::timestamptz ELSE fireflies_requested_at END,
    fireflies_status       = CASE WHEN _patch ? 'fireflies_status'       THEN NULLIF(_patch->>'fireflies_status','')         ELSE fireflies_status END,
    updated_at             = now()
  WHERE lesson_id = _lesson_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_lesson_details_safe(uuid, jsonb) TO authenticated;
