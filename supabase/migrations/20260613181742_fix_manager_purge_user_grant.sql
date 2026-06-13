-- Fix: restore EXECUTE grant on manager_purge_user.
--
-- A later CREATE OR REPLACE FUNCTION (migration 20260426080751) redefined
-- manager_purge_user but did NOT re-issue the GRANT. In PostgreSQL, while
-- CREATE OR REPLACE keeps existing privileges in most cases, the production DB
-- ended up with `authenticated` lacking EXECUTE — managers hit
-- "permission denied for function manager_purge_user" when deleting a user.
--
-- Re-assert the intended privileges explicitly and idempotently. The function
-- itself is SECURITY DEFINER and checks has_role(manager) internally, so
-- granting EXECUTE to authenticated is safe (non-managers are rejected at runtime).

REVOKE ALL ON FUNCTION public.manager_purge_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_purge_user(uuid) TO authenticated;
