CREATE OR REPLACE FUNCTION public.generate_telegram_link_code(_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _code text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  -- 8-char uppercase alphanumeric code derived from a UUID
  _code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.user_telegram_links (user_id, link_code, link_code_expires_at)
  VALUES (_user_id, _code, now() + interval '30 minutes')
  ON CONFLICT (user_id) DO UPDATE
    SET link_code = EXCLUDED.link_code,
        link_code_expires_at = EXCLUDED.link_code_expires_at,
        updated_at = now();

  RETURN _code;
END;
$function$;