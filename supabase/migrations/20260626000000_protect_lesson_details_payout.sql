-- ============================================================================
-- Protect hub→tutor payout columns on lesson_details from tutor tampering
-- Release audit 2026-06-20 · finding F2 (P1)
-- ----------------------------------------------------------------------------
-- GAP: lesson_details has no write-side protection on the tutor-payout columns.
-- A tutor's row-level UPDATE policy on lesson_details is column-unrestricted, so
-- the Supabase API would accept a direct UPDATE to tutor_payout /
-- tutor_payout_status / tutor_paid_at on their own lessons — letting a hub tutor
-- inflate what the hub records as owed to them.
--
-- FIX: mirror the existing protect_lesson_financials() guard (which lives on the
-- `lessons` table) onto lesson_details, but ONLY for the tutor-payout side.
--
-- ⚠️ DELIBERATELY NOT GUARDED HERE: the student-payment side
-- (student_price / student_payment_status / student_paid_at). Independent tutors
-- legitimately collect from their own students and mark those payments via
-- lesson_details (FinancesPage.togglePayment) as non-managers. Guarding those
-- would BREAK independent payment marking — that is the trap to avoid. Content
-- fields (homework, summary, fireflies_*, student_notes) are likewise untouched.
--
-- WHY THIS IS SAFE FOR BOTH MODELS:
--   • Intended matrix (src/test/lesson-financials-matrix.test.ts): tutor_payout*
--     is editable by MANAGER only — no tutor (hub or independent) edits it.
--   • No edge function / service-role path UPDATEs tutor_payout on lesson_details
--     (verified: functions only SELECT it).
--   • Manager flows (incl. the mark_tutor_payouts_paid RPC) run with the
--     manager's auth.uid(), so has_role(manager) = true → exempt.
--   • Uses IS DISTINCT FROM, so idempotent/no-op writes by non-managers pass;
--     only an actual change to a payout field is blocked.
--
-- ⚠️ NOT LIVE UNTIL APPLIED. A migration file in the repo is not in prod until
--    applied via Supabase (Dashboard SQL editor, or ask Lovable to apply it).
--    ORDERING INVARIANT: this timestamp must be strictly ABOVE the live
--    high-water mark. The newest repo migration at authoring time was
--    20260625000000. If Lovable has applied anything newer, bump this filename.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_lesson_details_payout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Manager (hub admin) can change anything.
  IF public.has_role(auth.uid(), 'manager') THEN
    RETURN NEW;
  END IF;

  -- Non-managers may not change the hub→tutor payout fields.
  IF NEW.tutor_payout         IS DISTINCT FROM OLD.tutor_payout
     OR NEW.tutor_payout_status IS DISTINCT FROM OLD.tutor_payout_status
     OR NEW.tutor_paid_at        IS DISTINCT FROM OLD.tutor_paid_at
  THEN
    RAISE EXCEPTION 'Only a manager can change tutor payout fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_lesson_details_payout ON public.lesson_details;
CREATE TRIGGER trg_protect_lesson_details_payout
BEFORE UPDATE ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.protect_lesson_details_payout();

-- ── VERIFY AFTER APPLYING ────────────────────────────────────────────────────
-- 1) As a HUB TUTOR (anon key, that tutor's JWT), expect FAILURE:
--      update lesson_details set tutor_payout = coalesce(tutor_payout,0) + 1000
--        where lesson_id = '<a lesson where you are the tutor>';
--    → must raise: "Only a manager can change tutor payout fields"
-- 2) As a MANAGER, the same UPDATE must SUCCEED.
-- 3) As an INDEPENDENT TUTOR, marking a student paid must STILL SUCCEED:
--      update lesson_details set student_payment_status = 'paid', student_paid_at = now()
--        where lesson_id = '<your independent lesson>';
-- ─────────────────────────────────────────────────────────────────────────────
