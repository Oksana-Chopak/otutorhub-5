
DROP POLICY IF EXISTS "Tutor inserts own settings (non-independent)" ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor updates own settings (non-independent)" ON public.tutor_workspace_settings;

CREATE POLICY "Tutor inserts own settings"
ON public.tutor_workspace_settings
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "Tutor updates own settings"
ON public.tutor_workspace_settings
FOR UPDATE TO authenticated
USING (auth.uid() = tutor_id)
WITH CHECK (auth.uid() = tutor_id);
