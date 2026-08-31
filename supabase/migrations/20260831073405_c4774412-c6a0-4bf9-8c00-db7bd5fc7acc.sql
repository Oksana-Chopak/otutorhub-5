ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'uk'
  CHECK (preferred_language in ('uk','en','sv')); 

COMMENT ON COLUMN public.profiles.preferred_language IS 'Preferred UI language for server-side notifications and emails';