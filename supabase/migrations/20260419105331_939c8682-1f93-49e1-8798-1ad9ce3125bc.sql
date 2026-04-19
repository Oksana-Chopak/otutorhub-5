-- 1) Fix BROKEN_UPDATE_POLICY: tutor lesson update self-reference bug
DROP POLICY IF EXISTS "Tutor updates own lessons (non-financial)" ON public.lessons;

CREATE POLICY "Tutor updates own lessons (non-financial)"
ON public.lessons
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
)
WITH CHECK (
  public.has_role(auth.uid(), 'tutor'::app_role)
  AND auth.uid() = tutor_id
);

-- Defense-in-depth: trigger already enforces immutability of financial fields and participants
-- Ensure the trigger is installed on lessons
DROP TRIGGER IF EXISTS trg_protect_lesson_financials ON public.lessons;
CREATE TRIGGER trg_protect_lesson_financials
BEFORE UPDATE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.protect_lesson_financials();

-- 2) PRIVILEGE_ESCALATION hardening on user_roles
-- Add a RESTRICTIVE policy that denies INSERT to anyone who is not a manager.
-- Combined with the existing permissive "Manager inserts roles", only managers can insert.
DROP POLICY IF EXISTS "Only managers can insert roles (restrictive)" ON public.user_roles;
CREATE POLICY "Only managers can insert roles (restrictive)"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

-- Also restrict UPDATE and DELETE the same way (defense in depth)
DROP POLICY IF EXISTS "Only managers can update roles (restrictive)" ON public.user_roles;
CREATE POLICY "Only managers can update roles (restrictive)"
ON public.user_roles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

DROP POLICY IF EXISTS "Only managers can delete roles (restrictive)" ON public.user_roles;
CREATE POLICY "Only managers can delete roles (restrictive)"
ON public.user_roles
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

-- Trigger-level guard: refuse any non-manager write to user_roles, regardless of policy gaps.
-- The handle_new_user() trigger runs as SECURITY DEFINER so it bypasses this check via the bypass flag below.
CREATE OR REPLACE FUNCTION public.guard_user_roles_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Allow when there is no auth context (e.g., signup trigger running as definer with no JWT)
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can modify user roles';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_roles_writes ON public.user_roles;
CREATE TRIGGER trg_guard_user_roles_writes
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.guard_user_roles_writes();