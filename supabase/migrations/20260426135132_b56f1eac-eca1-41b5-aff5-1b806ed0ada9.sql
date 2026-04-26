-- Add a SECURITY DEFINER helper to check if a profile is a pending ghost,
-- bypassing the new tightened SELECT RLS on profiles.
CREATE OR REPLACE FUNCTION public.is_pending_profile(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND is_pending = true
  );
$$;

-- Replace the user_roles INSERT policy for independent tutors so it uses the
-- definer helper (avoids being blocked by profiles SELECT RLS).
DROP POLICY IF EXISTS "Independent tutor assigns student role to own ghosts" ON public.user_roles;

CREATE POLICY "Independent tutor assigns student role to own ghosts"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_independent_tutor(auth.uid())
  AND role = 'student'::app_role
  AND public.is_pending_profile(user_id)
);