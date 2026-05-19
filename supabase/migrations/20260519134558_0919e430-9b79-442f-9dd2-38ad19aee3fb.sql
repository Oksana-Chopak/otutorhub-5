-- Add explicit deny-all policy on google_oauth_exchange_codes.
-- Table is service-role only (used by google-calendar-auth edge function);
-- service role bypasses RLS. This policy ensures no authenticated/anon user
-- can read or write codes directly, and silences the RLS-no-policy linter.
CREATE POLICY "Deny all client access"
ON public.google_oauth_exchange_codes
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);