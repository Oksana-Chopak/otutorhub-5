-- Cancellation rules: no-show charge, free reschedules per month, notify channels.
-- Extends the Pro cancellation policy on tutor_workspace_settings.
-- Apply in Supabase (Dashboard SQL Editor or Lovable) — NOT applied by git push.

-- 1) New policy columns
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS noshow_charge smallint NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS free_reschedules_per_month smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notify_telegram boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT false;

-- 2) Constraints (idempotent — mirror cancel_fee_percent style)
DO $$ BEGIN
  ALTER TABLE public.tutor_workspace_settings
    ADD CONSTRAINT tutor_workspace_settings_noshow_charge_check
    CHECK (noshow_charge IN (50, 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tutor_workspace_settings
    ADD CONSTRAINT tutor_workspace_settings_free_reschedules_per_month_check
    CHECK (free_reschedules_per_month BETWEEN 0 AND 31);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.tutor_workspace_settings.noshow_charge IS
  'Share of the lesson price charged on no-show: 100 (full) or 50 (half).';
COMMENT ON COLUMN public.tutor_workspace_settings.free_reschedules_per_month IS
  'How many free reschedules the student gets per month (integer >= 0).';
COMMENT ON COLUMN public.tutor_workspace_settings.notify_telegram IS
  'Send the cancellation rules to the student in Telegram on lesson create.';
COMMENT ON COLUMN public.tutor_workspace_settings.notify_email IS
  'Duplicate the cancellation rules to the student by email on lesson create.';
