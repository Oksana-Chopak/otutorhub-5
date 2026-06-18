-- ============================================================================
-- GROUP-LESSON BILLING foundation (per-student pricing model).
--
-- Decision (owner, 2026-06-18): each student in a group can have their OWN price
-- for group lessons ("своя ціна для кожного учня в групі"). Mirrors the individual
-- model: a configured rate per student + a per-lesson snapshot + per-student
-- payment status — but for the many-students-per-lesson case (student_id is NULL
-- on a group lesson; participants live in lesson_participants).
--
--   group_enrollments  = the CONFIGURED group rate for that (group, student)
--                        (like student_rates for individual lessons).
--   lesson_participants = the per-lesson SNAPSHOT + payment status for each
--                        student on a specific group lesson (like lesson_details
--                        for individual lessons, but one row PER participant).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Existing RLS already lets the group's tutor
-- and managers write these tables (FOR ALL) and students SELECT their own rows, so
-- no policy changes are needed (verified against the table policies).
-- ============================================================================

-- 1. Per-(group, student) configured rate.
ALTER TABLE public.group_enrollments
  ADD COLUMN IF NOT EXISTS price_per_lesson numeric,
  ADD COLUMN IF NOT EXISTS currency        text NOT NULL DEFAULT 'UAH',
  -- Hub only: what the hub pays the tutor for this student's seat (kept separate
  -- from price_per_lesson so the tutor never sees the hub margin).
  ADD COLUMN IF NOT EXISTS tutor_payout    numeric;

-- 2. Per-(group lesson, student) snapshot + payment status.
ALTER TABLE public.lesson_participants
  ADD COLUMN IF NOT EXISTS student_price         numeric,
  ADD COLUMN IF NOT EXISTS currency              text NOT NULL DEFAULT 'UAH',
  ADD COLUMN IF NOT EXISTS student_payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS student_paid_at       timestamptz,
  ADD COLUMN IF NOT EXISTS tutor_payout          numeric,
  ADD COLUMN IF NOT EXISTS tutor_payout_status   text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS tutor_paid_at         timestamptz;

-- Constrain the status values (drop+add so it's idempotent).
ALTER TABLE public.lesson_participants
  DROP CONSTRAINT IF EXISTS lesson_participants_student_payment_status_check;
ALTER TABLE public.lesson_participants
  ADD CONSTRAINT lesson_participants_student_payment_status_check
  CHECK (student_payment_status IN ('paid','unpaid'));

ALTER TABLE public.lesson_participants
  DROP CONSTRAINT IF EXISTS lesson_participants_tutor_payout_status_check;
ALTER TABLE public.lesson_participants
  ADD CONSTRAINT lesson_participants_tutor_payout_status_check
  CHECK (tutor_payout_status IN ('paid','unpaid'));

COMMENT ON COLUMN public.group_enrollments.price_per_lesson IS
  'Per-student price for this group''s lessons (each student in a group may differ).';
COMMENT ON COLUMN public.lesson_participants.student_price IS
  'Snapshot of the student''s group price for THIS lesson + per-student payment status.';
