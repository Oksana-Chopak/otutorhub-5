ALTER TABLE public.student_rates
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'UAH',
  ADD COLUMN IF NOT EXISTS payment_details text;