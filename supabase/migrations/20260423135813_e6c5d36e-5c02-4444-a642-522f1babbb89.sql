-- Linkage between app user and Telegram chat
CREATE TABLE public.user_telegram_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  chat_id bigint UNIQUE,
  link_code text UNIQUE,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_telegram_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User views own link"
  ON public.user_telegram_links FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "User inserts own link"
  ON public.user_telegram_links FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User updates own link"
  ON public.user_telegram_links FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User deletes own link"
  ON public.user_telegram_links FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Manager views all links"
  ON public.user_telegram_links FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER user_telegram_links_updated_at
  BEFORE UPDATE ON public.user_telegram_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Singleton state for Telegram bot getUpdates polling
CREATE TABLE public.telegram_bot_state (
  id int PRIMARY KEY CHECK (id = 1),
  update_offset bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views bot state"
  ON public.telegram_bot_state FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0);

-- Helper to generate a short, human-friendly link code
CREATE OR REPLACE FUNCTION public.generate_telegram_link_code(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  -- 8-char uppercase alphanumeric code
  _code := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', 'XYZ'), 1, 8));

  INSERT INTO public.user_telegram_links (user_id, link_code, link_code_expires_at)
  VALUES (_user_id, _code, now() + interval '30 minutes')
  ON CONFLICT (user_id) DO UPDATE
    SET link_code = EXCLUDED.link_code,
        link_code_expires_at = EXCLUDED.link_code_expires_at,
        updated_at = now();

  RETURN _code;
END;
$$;