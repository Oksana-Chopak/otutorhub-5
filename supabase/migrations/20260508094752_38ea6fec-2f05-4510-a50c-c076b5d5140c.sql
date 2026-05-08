ALTER TABLE public.tutor_workspace_settings
ADD COLUMN IF NOT EXISTS auto_complete_lessons boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_complete_prompted boolean NOT NULL DEFAULT false;