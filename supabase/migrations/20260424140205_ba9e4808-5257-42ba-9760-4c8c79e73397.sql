-- 1) Pin search_path on email queue helpers (they call into pgmq schema)
ALTER FUNCTION public.enqueue_email(text, jsonb)            SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint)            SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 2) Standardize manager policies to use the explicit two-argument has_role(auth.uid(), role)
--    Behavior is unchanged; this removes reliance on the single-argument overload.

-- profile_financial_contacts
DROP POLICY IF EXISTS "Managers manage financial contacts" ON public.profile_financial_contacts;
CREATE POLICY "Managers manage financial contacts"
ON public.profile_financial_contacts
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

DROP POLICY IF EXISTS "Managers see all financial contacts" ON public.profile_financial_contacts;
CREATE POLICY "Managers see all financial contacts"
ON public.profile_financial_contacts
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

-- manager_audit_log
DROP POLICY IF EXISTS "Managers view audit log" ON public.manager_audit_log;
CREATE POLICY "Managers view audit log"
ON public.manager_audit_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

-- tutor_subject_rates
DROP POLICY IF EXISTS "Manager manages tutor subject rates" ON public.tutor_subject_rates;
CREATE POLICY "Manager manages tutor subject rates"
ON public.tutor_subject_rates
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));