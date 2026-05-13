ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS payment_rules_configured boolean NOT NULL DEFAULT false;