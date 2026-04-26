ALTER TABLE public.student_rates
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_student_rates_archived_at
  ON public.student_rates (tutor_id, archived_at);