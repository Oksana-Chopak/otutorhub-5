-- Add Telegram digest preferences to tutor_workspace_settings
-- These control which digest notifications the tutor receives.
-- hasTelegramLink is detected from user_telegram_links (no new column needed).

ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS telegram_daily_digest  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_weekly_digest boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tutor_workspace_settings.telegram_daily_digest  IS
  'Send daily morning digest of today lessons + debts via Telegram bot.';
COMMENT ON COLUMN public.tutor_workspace_settings.telegram_weekly_digest IS
  'Send weekly summary every Monday via Telegram bot.';
