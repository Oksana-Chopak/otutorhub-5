-- Platform SUPERADMIN — a god-view gate for dedicated service-role admin endpoints
-- (e.g. the admin-stats function). DELIBERATELY kept OUT of the normal role system and
-- OUT of RLS: per-hub / per-user isolation stays strict, and superadmin power is
-- confined to audited service-role endpoints. This is forward-compatible with the future
-- multi-school product (each school admin = a hub manager scoped to their school; the
-- platform owner = a superadmin who sees across all schools via these endpoints).
--
-- Why a separate table (not a new app_role enum value):
--   • avoids the "ALTER TYPE ... ADD VALUE can't be used in the same tx" trap,
--   • keeps the god-flag entirely separate from the 69 manager/tutor/student RLS
--     policies, so it can never accidentally widen normal access.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on, NO policies → no anon/authenticated client can read or write this table.
-- Only the service role (used by trusted edge functions) bypasses RLS. Membership is
-- managed via SQL by the platform owner.
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Frontend "am I a superadmin?" check (to show the admin nav + gate the page). The real
-- enforcement is server-side in the edge function; this only drives UI.
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;

-- ── Seed the platform owner ──────────────────────────────────────────────────
-- ⚠️ SET THIS to YOUR real admin LOGIN email (the account you sign in to the app with).
-- If it doesn't match an existing account this simply inserts 0 rows (harmless) and the
-- admin panel will show "no access" until the correct row exists. To add later:
--   INSERT INTO public.platform_admins (user_id)
--   SELECT user_id FROM public.profile_contacts WHERE lower(email) = lower('you@example.com')
--   ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (user_id)
SELECT pc.user_id
FROM public.profile_contacts pc
WHERE lower(pc.email) = lower('oksana.chopak@hyperisland.se')
ON CONFLICT (user_id) DO NOTHING;
