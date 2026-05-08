ALTER TABLE public.tutor_referral_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS lead_name TEXT,
  ADD COLUMN IF NOT EXISTS lead_email TEXT,
  ADD COLUMN IF NOT EXISTS lead_phone TEXT,
  ADD COLUMN IF NOT EXISTS quiz_data JSONB;

ALTER TABLE public.tutor_referral_requests
  ALTER COLUMN student_id DROP NOT NULL;