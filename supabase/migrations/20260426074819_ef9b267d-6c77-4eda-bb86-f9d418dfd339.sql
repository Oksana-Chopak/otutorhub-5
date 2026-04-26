
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_archived_at
  ON public.profiles (archived_at);
