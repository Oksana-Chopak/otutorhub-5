-- Restore table-level grants on public.lessons.
-- RLS policies still strictly control row visibility and modification per role.
-- Without these grants, RLS subqueries from other tables fail with "permission denied for table lessons".

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessons TO authenticated;
GRANT SELECT ON public.lessons TO anon;
GRANT ALL ON public.lessons TO service_role;

-- Also ensure profile_financial_contacts has proper grants (managers need INSERT/UPDATE via app)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_financial_contacts TO authenticated;
GRANT ALL ON public.profile_financial_contacts TO service_role;

-- Add missing INSERT/UPDATE/DELETE policies for profile_financial_contacts (managers only)
DROP POLICY IF EXISTS "Managers manage financial contacts" ON public.profile_financial_contacts;
CREATE POLICY "Managers manage financial contacts"
  ON public.profile_financial_contacts
  FOR ALL
  TO authenticated
  USING (public.has_role('manager'::app_role))
  WITH CHECK (public.has_role('manager'::app_role));

DROP POLICY IF EXISTS "Users update own financial contacts" ON public.profile_financial_contacts;
CREATE POLICY "Users update own financial contacts"
  ON public.profile_financial_contacts
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own financial contacts" ON public.profile_financial_contacts;
CREATE POLICY "Users insert own financial contacts"
  ON public.profile_financial_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());