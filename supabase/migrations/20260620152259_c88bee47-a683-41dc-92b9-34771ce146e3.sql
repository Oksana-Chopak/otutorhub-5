-- Block non-managers from writing tutor_payout* (and fireflies_*) on INSERT to lesson_details.
-- UPDATE side is already locked via column-level GRANT (20260620141443).
-- INSERT side has no column-level revoke, so add a BEFORE INSERT trigger that nulls
-- payout columns for non-managers, mirroring the existing BEFORE UPDATE guard.

CREATE OR REPLACE FUNCTION public.protect_lesson_details_payout_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role and managers to set payout columns directly
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Non-manager (hub tutor / independent tutor) — strip payout fields.
  -- The autofill_lesson_details_prices trigger will then populate tutor_payout
  -- from student_rates for hub lessons.
  NEW.tutor_payout := NULL;
  NEW.tutor_payout_status := NULL;
  NEW.tutor_paid_at := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_lesson_details_payout_insert ON public.lesson_details;
CREATE TRIGGER trg_protect_lesson_details_payout_insert
BEFORE INSERT ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.protect_lesson_details_payout_insert();
