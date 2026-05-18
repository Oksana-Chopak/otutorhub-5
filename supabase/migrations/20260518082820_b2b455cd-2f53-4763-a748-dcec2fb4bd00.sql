
-- 1) Opt-in flag on workspace settings (default true)
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT true;

-- 2) Campaigns table
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  subject text NOT NULL,
  html_body text NOT NULL,
  segment text NOT NULL,
  recipients_total integer NOT NULL DEFAULT 0,
  recipients_sent integer NOT NULL DEFAULT 0,
  recipients_failed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers manage campaigns"
  ON public.marketing_campaigns
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_marketing_campaigns_updated_at
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Suppression list
CREATE TABLE IF NOT EXISTS public.marketing_unsubscribes (
  email text PRIMARY KEY,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

ALTER TABLE public.marketing_unsubscribes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view unsubscribes"
  ON public.marketing_unsubscribes
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- 4) Unsubscribe tokens
CREATE TABLE IF NOT EXISTS public.marketing_unsubscribe_tokens (
  token text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
-- Service role only; no explicit policies = no access for authenticated/anon

-- 5) Recipients function
CREATE OR REPLACE FUNCTION public.get_marketing_recipients(_segment text)
RETURNS TABLE (user_id uuid, email text, first_name text, last_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can list marketing recipients';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    COALESCE(pc.email, au.email) AS email,
    p.first_name,
    p.last_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'tutor'::app_role
  JOIN public.tutor_workspace_settings tws ON tws.tutor_id = p.id
  LEFT JOIN public.profile_contacts pc ON pc.user_id = p.id
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE tws.independent_workspace = true
    AND tws.marketing_opt_in = true
    AND p.is_pending = false
    AND p.archived_at IS NULL
    AND COALESCE(pc.email, au.email) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_unsubscribes mu
      WHERE mu.email = COALESCE(pc.email, au.email)
    )
    AND CASE _segment
      WHEN 'all_independent' THEN true
      WHEN 'trial' THEN tws.subscription_status = 'trial'
      WHEN 'trial_ending_soon' THEN tws.subscription_status = 'trial' AND tws.trial_until BETWEEN now() AND now() + interval '3 days'
      WHEN 'pro_active' THEN tws.subscription_status = 'pro' AND (tws.subscription_until IS NULL OR tws.subscription_until > now())
      WHEN 'expired' THEN (tws.subscription_status = 'expired') OR (tws.subscription_status = 'trial' AND tws.trial_until < now())
      ELSE false
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_marketing_recipients(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_marketing_recipients(text) TO authenticated;
