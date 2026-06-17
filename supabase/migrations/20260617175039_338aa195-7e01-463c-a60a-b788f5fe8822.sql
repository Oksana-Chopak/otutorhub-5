REVOKE EXECUTE ON FUNCTION public.wallet_balance_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_resettle_all() FROM PUBLIC, anon, authenticated;