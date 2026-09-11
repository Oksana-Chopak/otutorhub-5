CREATE TABLE IF NOT EXISTS public.landing_handoffs (
  token         text PRIMARY KEY,
  list_text     text NOT NULL CHECK (length(list_text) BETWEEN 3 AND 12000),
  digest_text   text NOT NULL CHECK (length(digest_text) BETWEEN 3 AND 4000),
  lang          text NOT NULL DEFAULT 'uk' CHECK (lang IN ('uk', 'en', 'sv')),
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  chat_id       bigint,
  tg_first_name text,
  claimed_at    timestamptz,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_up_at  timestamptz
);

COMMENT ON TABLE public.landing_handoffs IS
  'Список з лендінгу + готовий дайджест під токен для Telegram ДО реєстрації. 24 години; без політик — лише service role і DEFINER-RPC.';

CREATE INDEX IF NOT EXISTS landing_handoffs_ip_created_idx ON public.landing_handoffs (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS landing_handoffs_expires_idx ON public.landing_handoffs (expires_at);

ALTER TABLE public.landing_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.landing_handoffs FROM anon, authenticated;
GRANT ALL ON public.landing_handoffs TO service_role;

ALTER TABLE public.telegram_bot_state ADD COLUMN IF NOT EXISTS bot_username text;

CREATE OR REPLACE FUNCTION public.create_landing_handoff(_list text, _digest text, _lang text DEFAULT 'uk')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _token   text;
  _ip      text;
  _ip_hash text;
  _recent  int;
  _today   int;
BEGIN
  IF _list IS NULL OR length(_list) < 3 OR length(_list) > 12000 THEN
    RAISE EXCEPTION 'LIST_INVALID' USING ERRCODE = 'check_violation';
  END IF;
  IF _digest IS NULL OR length(_digest) < 3 OR length(_digest) > 4000 THEN
    RAISE EXCEPTION 'DIGEST_INVALID' USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    _ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  EXCEPTION WHEN OTHERS THEN
    _ip := '';
  END;
  _ip_hash := CASE WHEN trim(_ip) = '' THEN NULL ELSE md5(trim(_ip)) END;

  IF _ip_hash IS NOT NULL THEN
    SELECT count(*) INTO _recent FROM public.landing_handoffs
     WHERE ip_hash = _ip_hash AND created_at > now() - interval '1 hour';
    IF _recent >= 5 THEN
      RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  SELECT count(*) INTO _today FROM public.landing_handoffs WHERE created_at > now() - interval '1 day';
  IF _today >= 2000 THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  _token := 'lh_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.landing_handoffs (token, list_text, digest_text, lang, ip_hash)
  VALUES (_token, _list, _digest, CASE WHEN _lang IN ('uk','en','sv') THEN _lang ELSE 'uk' END, _ip_hash);
  RETURN _token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_landing_handoff(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_landing_handoff(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.read_landing_handoff(_token text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT h.list_text FROM public.landing_handoffs h
   WHERE h.token = _token AND h.expires_at > now() AND h.user_id IS NULL
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.read_landing_handoff(text) FROM public;
GRANT EXECUTE ON FUNCTION public.read_landing_handoff(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.landing_bot_username()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.bot_username FROM public.telegram_bot_state s WHERE s.id = 1;
$$;

REVOKE ALL ON FUNCTION public.landing_bot_username() FROM public;
GRANT EXECUTE ON FUNCTION public.landing_bot_username() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.attach_landing_handoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _token text := NEW.raw_user_meta_data->>'landing_handoff';
  _h     record;
BEGIN
  IF _token IS NULL OR _token = '' THEN RETURN NEW; END IF;

  BEGIN
    SELECT * INTO _h FROM public.landing_handoffs WHERE token = _token AND user_id IS NULL;
    IF NOT FOUND THEN RETURN NEW; END IF;

    UPDATE public.landing_handoffs SET user_id = NEW.id, signed_up_at = now() WHERE token = _token;

    IF _h.chat_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.user_telegram_links (user_id, chat_id, linked_at)
        VALUES (NEW.id, _h.chat_id, now())
        ON CONFLICT (user_id) DO UPDATE
          SET chat_id = EXCLUDED.chat_id, linked_at = now(), link_code = NULL, link_code_expires_at = NULL, updated_at = now();
        UPDATE public.tutor_workspace_settings SET daily_digest_enabled = true WHERE tutor_id = NEW.id;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'attach_landing_handoff skipped: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_landing_handoff ON auth.users;
CREATE TRIGGER on_auth_user_created_landing_handoff
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.attach_landing_handoff();

DO $$
DECLARE
  job_id int;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'landing-handoffs-cleanup';
  IF FOUND THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END$$;

SELECT cron.schedule(
  'landing-handoffs-cleanup',
  '15 3 * * *',
  $$ DELETE FROM public.landing_handoffs WHERE expires_at < now() - interval '7 days'; $$
);