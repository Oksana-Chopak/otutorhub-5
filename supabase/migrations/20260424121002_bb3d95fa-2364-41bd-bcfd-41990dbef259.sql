CREATE OR REPLACE FUNCTION public.guard_user_roles_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row record := COALESCE(NEW, OLD);
  _is_ghost boolean;
BEGIN
  -- Allow when there is no auth context (e.g., signup trigger running as definer with no JWT)
  IF auth.uid() IS NULL THEN
    RETURN _row;
  END IF;

  -- Manager can do anything
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN _row;
  END IF;

  -- Allow independent tutor to assign 'student' role to their own ghost profile
  IF TG_OP = 'INSERT'
     AND NEW.role = 'student'::app_role
     AND public.is_independent_tutor(auth.uid()) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.user_id AND p.is_pending = true
    ) INTO _is_ghost;
    IF _is_ghost THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Allow cleanup: independent tutor can delete the 'student' role they just assigned to their ghost
  IF TG_OP = 'DELETE'
     AND OLD.role = 'student'::app_role
     AND public.is_independent_tutor(auth.uid()) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = OLD.user_id AND p.is_pending = true
    ) INTO _is_ghost;
    IF _is_ghost THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'Only managers can modify user roles';
END;
$function$;