ALTER TABLE public.tutor_workspace_settings 
ADD COLUMN IF NOT EXISTS custom_currencies TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.tutor_workspace_settings.custom_currencies IS 
  'Array of custom currency codes added by this workspace, e.g. ["CZK","NOK"]';