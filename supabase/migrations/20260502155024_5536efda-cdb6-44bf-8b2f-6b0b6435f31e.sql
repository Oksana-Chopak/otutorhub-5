-- Restore EXECUTE on is_pending_profile for authenticated/anon roles.
-- This function is used inside the RLS policy "Independent tutor assigns student role to own ghosts"
-- on public.user_roles. A previous security hardening migration revoked it, which caused
-- "permission denied for function is_pending_profile" when a manager (or any user) inserted into user_roles,
-- because Postgres evaluates all permissive INSERT policies.
GRANT EXECUTE ON FUNCTION public.is_pending_profile(uuid) TO authenticated, anon;