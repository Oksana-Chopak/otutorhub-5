-- Marketing unsubscribe tokens are only accessed by edge functions via service role.
-- Add an explicit deny policy so the table has at least one policy (satisfies linter)
-- while keeping the table inaccessible to anon/authenticated clients.
CREATE POLICY "Deny all client access to unsubscribe tokens"
ON public.marketing_unsubscribe_tokens
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);