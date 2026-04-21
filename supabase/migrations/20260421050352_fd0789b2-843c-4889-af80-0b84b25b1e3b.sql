-- 1. Audit log table
CREATE TABLE public.manager_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_manager_audit_log_created_at ON public.manager_audit_log (created_at DESC);
CREATE INDEX idx_manager_audit_log_entity ON public.manager_audit_log (entity_type, entity_id);
CREATE INDEX idx_manager_audit_log_actor ON public.manager_audit_log (actor_id);

ALTER TABLE public.manager_audit_log ENABLE ROW LEVEL SECURITY;

-- Only managers can read
CREATE POLICY "Managers view audit log"
ON public.manager_audit_log FOR SELECT TO authenticated
USING (public.has_role('manager'::app_role));

-- Immutable: no INSERT/UPDATE/DELETE policies for any role.
-- Triggers will write rows via SECURITY DEFINER functions.

-- 2. Trigger function: log role changes
CREATE OR REPLACE FUNCTION public.log_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, after)
    VALUES (auth.uid(), 'role.assigned', 'user_role', NEW.user_id,
            jsonb_build_object('role', NEW.role, 'user_id', NEW.user_id));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before, after)
      VALUES (auth.uid(), 'role.updated', 'user_role', NEW.user_id,
              jsonb_build_object('role', OLD.role, 'user_id', OLD.user_id),
              jsonb_build_object('role', NEW.role, 'user_id', NEW.user_id));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before)
    VALUES (auth.uid(), 'role.removed', 'user_role', OLD.user_id,
            jsonb_build_object('role', OLD.role, 'user_id', OLD.user_id));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_log_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_user_role_changes();

-- 3. Trigger function: log profile deletions
CREATE OR REPLACE FUNCTION public.log_profile_deletions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before)
  VALUES (auth.uid(), 'profile.deleted', 'profile', OLD.id,
          jsonb_build_object(
            'first_name', OLD.first_name,
            'last_name', OLD.last_name,
            'is_pending', OLD.is_pending
          ));
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_log_profile_deletions
AFTER DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_profile_deletions();

-- 4. Trigger function: log lesson financial changes
CREATE OR REPLACE FUNCTION public.log_lesson_financial_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed boolean := false;
  _before jsonb := '{}'::jsonb;
  _after  jsonb := '{}'::jsonb;
BEGIN
  IF NEW.student_price IS DISTINCT FROM OLD.student_price THEN
    _changed := true;
    _before := _before || jsonb_build_object('student_price', OLD.student_price);
    _after  := _after  || jsonb_build_object('student_price', NEW.student_price);
  END IF;
  IF NEW.tutor_payout IS DISTINCT FROM OLD.tutor_payout THEN
    _changed := true;
    _before := _before || jsonb_build_object('tutor_payout', OLD.tutor_payout);
    _after  := _after  || jsonb_build_object('tutor_payout', NEW.tutor_payout);
  END IF;
  IF NEW.student_payment_status IS DISTINCT FROM OLD.student_payment_status THEN
    _changed := true;
    _before := _before || jsonb_build_object('student_payment_status', OLD.student_payment_status);
    _after  := _after  || jsonb_build_object('student_payment_status', NEW.student_payment_status);
  END IF;
  IF NEW.tutor_payout_status IS DISTINCT FROM OLD.tutor_payout_status THEN
    _changed := true;
    _before := _before || jsonb_build_object('tutor_payout_status', OLD.tutor_payout_status);
    _after  := _after  || jsonb_build_object('tutor_payout_status', NEW.tutor_payout_status);
  END IF;

  IF _changed THEN
    INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before, after)
    VALUES (auth.uid(), 'lesson.financials_updated', 'lesson', NEW.id, _before, _after);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_lesson_financials
AFTER UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.log_lesson_financial_changes();
