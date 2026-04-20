-- Remove direct table-level read access for application users.
-- All client reads must go through the security-invoker view 'lessons_visible'
-- which masks counterparty financial columns based on the caller's role.
REVOKE SELECT ON public.lessons FROM authenticated;
REVOKE SELECT ON public.lessons FROM anon;