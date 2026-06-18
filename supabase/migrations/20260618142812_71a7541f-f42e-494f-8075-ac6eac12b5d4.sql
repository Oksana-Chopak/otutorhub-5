CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id uuid,
  _type    text,
  _title   text,
  _body    text DEFAULT NULL,
  _link    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing uuid;
  _new_id   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  IF _user_id IS NULL OR _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'user_id, type and title are required';
  END IF;

  -- Dedup: skip if the same user+type was notified within the last 24h.
  SELECT id INTO _existing
    FROM public.notifications
   WHERE user_id = _user_id
     AND type = _type
     AND created_at >= now() - interval '24 hours'
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_user_id, _type, _title, _body, _link)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text) TO authenticated;