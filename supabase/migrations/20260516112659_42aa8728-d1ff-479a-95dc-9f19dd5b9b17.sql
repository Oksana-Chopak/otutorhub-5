REVOKE EXECUTE ON FUNCTION public.wallet_topup(uuid, uuid, integer, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_topup(uuid, uuid, integer, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wallet_topup(uuid, uuid, integer, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_independent_tutor(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_independent_tutor(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_independent_tutor(uuid) TO authenticated;