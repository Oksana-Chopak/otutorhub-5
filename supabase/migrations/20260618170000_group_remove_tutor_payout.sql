/* ============================================================================
   SECURITY FIX (#1, #2): students could read tutor payout data.

   20260618160000 added tutor_payout columns to group_enrollments and
   lesson_participants. But students have SELECT on their OWN rows of BOTH tables
   ("Student views own enrollments" / "student_views_participation"), so a student
   could read what the hub pays the tutor for their seat — a hub-margin leak.

   RLS is row-level and can't hide a column per-role, and these columns are not used
   by any code yet (group billing is mid-build). So the clean fix is to REMOVE them.
   Hub group payout will be reintroduced in a student-safe place (NOT on a row a
   student can SELECT) when group scheduling lands (phase 2).

   Idempotent: DROP COLUMN IF EXISTS.
   ============================================================================ */
ALTER TABLE public.group_enrollments
  DROP COLUMN IF EXISTS tutor_payout;

ALTER TABLE public.lesson_participants
  DROP COLUMN IF EXISTS tutor_payout,
  DROP COLUMN IF EXISTS tutor_payout_status,
  DROP COLUMN IF EXISTS tutor_paid_at;
