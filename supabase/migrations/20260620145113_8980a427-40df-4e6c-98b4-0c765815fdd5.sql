-- 1) lesson_details: defense-in-depth RESTRICTIVE SELECT
DROP POLICY IF EXISTS "lesson_details_restrict_direct_select" ON public.lesson_details;
CREATE POLICY "lesson_details_restrict_direct_select" ON public.lesson_details
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'manager')
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_details.lesson_id AND l.tutor_id = auth.uid()
    )
  );

-- 2) suppressed_emails: target service_role directly + RESTRICTIVE deny for anon/authenticated
DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "Service role can view suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "Service role inserts suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "Service role reads suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "suppressed_emails_service_insert" ON public.suppressed_emails;
DROP POLICY IF EXISTS "suppressed_emails_service_select" ON public.suppressed_emails;
DROP POLICY IF EXISTS "suppressed_emails_service_update" ON public.suppressed_emails;
DROP POLICY IF EXISTS "suppressed_emails_deny_clients" ON public.suppressed_emails;

CREATE POLICY "suppressed_emails_service_select" ON public.suppressed_emails
  AS PERMISSIVE FOR SELECT TO service_role USING (true);

CREATE POLICY "suppressed_emails_service_insert" ON public.suppressed_emails
  AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "suppressed_emails_service_update" ON public.suppressed_emails
  AS PERMISSIVE FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "suppressed_emails_deny_clients" ON public.suppressed_emails
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
