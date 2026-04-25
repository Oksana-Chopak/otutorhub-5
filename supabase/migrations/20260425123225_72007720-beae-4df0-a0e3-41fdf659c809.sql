
CREATE OR REPLACE FUNCTION public.is_pending_email(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_contacts c
    JOIN public.profiles p ON p.id = c.user_id
    WHERE p.is_pending = true
      AND _email IS NOT NULL
      AND _email <> ''
      AND lower(c.email) = lower(_email)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_pending_email(text) TO anon, authenticated;
