-- notify_managers(_type,_title,_body,_link) — fan a notification out to every manager.
--
-- Why an RPC: a non-manager (e.g. a self-signup student who just filed a tutor
-- request) CANNOT read public.user_roles to enumerate managers — the only SELECT
-- policies are "own row" and "manager views all". So a client-side fan-out from a
-- student silently finds zero managers. This SECURITY DEFINER function runs with
-- elevated rights to find the managers, then routes each notification through the
-- existing create_notification() (which dedups per (user,type) within 24h and
-- fires the web-push trigger). The CALLER builds the localized title/body, so i18n
-- stays client-side.
--
-- Idempotent (CREATE OR REPLACE). Safe: it only writes notifications (title/body/
-- link), returns a count, and requires an authenticated caller.
CREATE OR REPLACE FUNCTION public.notify_managers(
  _type  text,
  _title text,
  _body  text DEFAULT NULL,
  _link  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _m     record;
  _count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'type and title are required';
  END IF;

  FOR _m IN
    SELECT DISTINCT user_id
      FROM public.user_roles
     WHERE role = 'manager'::app_role
  LOOP
    PERFORM public.create_notification(_m.user_id, _type, _title, _body, _link);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

REVOKE ALL  ON FUNCTION public.notify_managers(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_managers(text, text, text, text) TO authenticated;
