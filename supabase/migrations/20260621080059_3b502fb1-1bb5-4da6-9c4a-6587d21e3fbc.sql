-- 1) Drop student SELECT policy (lead PII leak)
DROP POLICY IF EXISTS "Student views own referral requests" ON public.tutor_referral_requests;
DROP POLICY IF EXISTS "Students view own referral requests" ON public.tutor_referral_requests;
DROP POLICY IF EXISTS "students_view_own_referral_requests" ON public.tutor_referral_requests;

-- 2) Guard lead_* on insert: only manager or service_role may set them
CREATE OR REPLACE FUNCTION public.guard_tutor_referral_lead_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean;
BEGIN
  is_privileged := (
    current_setting('role', true) = 'service_role'
    OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'manager'))
  );

  IF NOT is_privileged THEN
    NEW.lead_name  := NULL;
    NEW.lead_email := NULL;
    NEW.lead_phone := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tutor_referral_lead_fields ON public.tutor_referral_requests;
CREATE TRIGGER trg_guard_tutor_referral_lead_fields
BEFORE INSERT OR UPDATE ON public.tutor_referral_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_tutor_referral_lead_fields();