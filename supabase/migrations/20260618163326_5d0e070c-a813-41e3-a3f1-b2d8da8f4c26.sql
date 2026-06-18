-- GROUP-LESSON BILLING foundation (per-student pricing model).
ALTER TABLE public.group_enrollments
  ADD COLUMN IF NOT EXISTS price_per_lesson numeric,
  ADD COLUMN IF NOT EXISTS currency        text NOT NULL DEFAULT 'UAH',
  ADD COLUMN IF NOT EXISTS tutor_payout    numeric;

ALTER TABLE public.lesson_participants
  ADD COLUMN IF NOT EXISTS student_price         numeric,
  ADD COLUMN IF NOT EXISTS currency              text NOT NULL DEFAULT 'UAH',
  ADD COLUMN IF NOT EXISTS student_payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS student_paid_at       timestamptz,
  ADD COLUMN IF NOT EXISTS tutor_payout          numeric,
  ADD COLUMN IF NOT EXISTS tutor_payout_status   text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS tutor_paid_at         timestamptz;

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