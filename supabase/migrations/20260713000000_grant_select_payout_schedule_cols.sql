-- FIX: "the payout schedule keeps flying off."
--
-- PayoutScheduleCard SAVES the schedule via the SECURITY DEFINER RPC
-- set_tutor_payout_schedule (which bypasses column grants — so the save itself always
-- persisted). But the card RELOADS the schedule with a plain SELECT of
-- payout_frequency / payout_weekday / payout_monthday on tutor_details. Migration
-- 20260419081232 did `REVOKE SELECT ON tutor_details FROM authenticated` and then granted
-- SELECT on only a handful of columns — the payout_* columns (added later, for the payout
-- schedule feature) were never in that grant. So every reload hit
-- "permission denied for column payout_frequency", the card treated the columns as
-- missing, and the schedule appeared reset on every reopen.
--
-- Fix: grant SELECT on the payout-schedule columns. RLS still controls WHICH rows each
-- role can read (a manager sees their hub tutors; a tutor sees their own row), so this
-- only makes the already-permitted rows' payout schedule actually readable.
GRANT SELECT (payout_frequency, payout_weekday, payout_monthday, payout_anchor)
  ON public.tutor_details TO authenticated;
