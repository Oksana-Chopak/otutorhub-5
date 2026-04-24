-- Add trial_until column
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS trial_until timestamptz;

-- Update subscription_status constraint to include 'trial'
ALTER TABLE public.tutor_workspace_settings
  DROP CONSTRAINT IF EXISTS tutor_workspace_settings_subscription_status_check;

ALTER TABLE public.tutor_workspace_settings
  ADD CONSTRAINT tutor_workspace_settings_subscription_status_check
  CHECK (subscription_status = ANY (ARRAY['free'::text, 'trial'::text, 'active'::text, 'past_due'::text, 'cancelled'::text]));

-- Disable the guard trigger temporarily for backfill
ALTER TABLE public.tutor_workspace_settings DISABLE TRIGGER guard_tutor_workspace_settings_update;

-- Backfill: existing independent tutors who are still on free get a fresh 14-day trial
UPDATE public.tutor_workspace_settings
SET subscription_status = 'trial',
    trial_until = now() + interval '14 days'
WHERE independent_workspace = true
  AND subscription_status = 'free'
  AND trial_until IS NULL;

-- Re-enable trigger
ALTER TABLE public.tutor_workspace_settings ENABLE TRIGGER guard_tutor_workspace_settings_update;

-- Update guard trigger: also block tutors from changing trial_until themselves
CREATE OR REPLACE FUNCTION public.guard_tutor_workspace_settings_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
    RAISE EXCEPTION 'Only a manager can change subscription_status';
  END IF;

  IF NEW.subscription_until IS DISTINCT FROM OLD.subscription_until THEN
    RAISE EXCEPTION 'Only a manager can change subscription_until';
  END IF;

  IF NEW.trial_until IS DISTINCT FROM OLD.trial_until THEN
    RAISE EXCEPTION 'Only a manager can change trial_until';
  END IF;

  IF NEW.independent_workspace IS DISTINCT FROM OLD.independent_workspace THEN
    RAISE EXCEPTION 'Only a manager can change independent_workspace';
  END IF;

  RETURN NEW;
END;
$$;

-- Helper: is_pro_active = active OR trial that hasn't expired
CREATE OR REPLACE FUNCTION public.is_tutor_pro(_tutor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tutor_workspace_settings s
    WHERE s.tutor_id = _tutor_id
      AND (
        s.subscription_status = 'active'
        OR (s.subscription_status = 'trial' AND s.trial_until > now())
      )
  );
$$;