-- Restrict tutors from self-granting independent workspace status.
-- Only managers (or the SECURITY DEFINER signup trigger) may set independent_workspace = true.

DROP POLICY IF EXISTS "Tutor inserts own settings" ON public.tutor_workspace_settings;
DROP POLICY IF EXISTS "Tutor updates own settings" ON public.tutor_workspace_settings;

-- Tutors may insert their own settings ONLY when independent_workspace is false.
CREATE POLICY "Tutor inserts own settings (non-independent)"
ON public.tutor_workspace_settings
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = tutor_id
  AND independent_workspace = false
);

-- Tutors may update their own settings, but cannot flip independent_workspace.
-- The existing guard_tutor_workspace_settings_update trigger also blocks changes
-- to independent_workspace / subscription fields by non-managers; this WITH CHECK
-- adds defense in depth at the policy layer.
CREATE POLICY "Tutor updates own settings (non-independent)"
ON public.tutor_workspace_settings
FOR UPDATE
TO authenticated
USING (auth.uid() = tutor_id)
WITH CHECK (
  auth.uid() = tutor_id
  AND independent_workspace = false
);