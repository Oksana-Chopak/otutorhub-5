REVOKE ALL ON FUNCTION public.manager_purge_user(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.manager_purge_user(uuid) TO authenticated;