-- Rotate cron shared secret in vault to a fresh value
SELECT vault.update_secret(
  'd2764dde-1966-49a0-a1f9-a4e201ac3245'::uuid,
  'ed668804c04ac6301d6cd9daa5f87595f03fb30350990f229dce3bcad5f9c062',
  'cron_shared_secret',
  'Shared secret used by pg_cron jobs to authenticate to internal edge functions (lesson-reminders, payment-reminders, tutor-daily-digest)'
);

-- Helper RPC the edge functions can call (with service role) to fetch the expected secret
CREATE OR REPLACE FUNCTION public.get_cron_shared_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_cron_shared_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_shared_secret() TO service_role;