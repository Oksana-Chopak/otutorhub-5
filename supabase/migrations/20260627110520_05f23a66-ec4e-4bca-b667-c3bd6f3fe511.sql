CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.platform_admins TO service_role;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

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

INSERT INTO public.platform_admins (user_id)
SELECT pc.user_id
FROM public.profile_contacts pc
WHERE lower(pc.email) = lower('oksana.chopak@hyperisland.se')
ON CONFLICT (user_id) DO NOTHING;