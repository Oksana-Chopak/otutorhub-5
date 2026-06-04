-- Add Telegram lesson reminder preferences to tutor_workspace_settings.
-- telegram_reminder_1h:  notify tutor+student 60 min before lesson
-- telegram_reminder_15m: notify tutor+student 15 min before lesson

ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS telegram_reminder_1h  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_reminder_15m boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tutor_workspace_settings.telegram_reminder_1h  IS
  'Send Telegram reminder to tutor and student 60 minutes before lesson.';
COMMENT ON COLUMN public.tutor_workspace_settings.telegram_reminder_15m IS
  'Send Telegram reminder to tutor and student 15 minutes before lesson.';
