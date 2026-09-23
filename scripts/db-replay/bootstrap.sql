-- ─────────────────────────────────────────────────────────────────────────────
-- bootstrap.sql — «порожній Supabase» на чистому Postgres 16.
--
-- Навіщо: щоб усю історію supabase/migrations/ можна було ПРОГНАТИ (не прочитати)
-- на кожен пуш — у CI і в будь-якій сесії агента. Міграція, що падає тут,
-- впала б і в Lovable; тригер чи RPC, що поводиться не так, як обіцяє код,
-- ловиться сценарієм, а не власницею на живих людях.
--
-- Тут стоять лише «оболонки» службових схем Supabase (auth, storage, cron, net,
-- pgmq, vault, realtime): рівно стільки, щоб міграції застосувались і поводились
-- так само. Жодної бізнес-логіки проєкту тут немає і бути не може.
-- ─────────────────────────────────────────────────────────────────────────────

-- Ролі Supabase. NOLOGIN — ми лише роздаємо їм права, ніколи не логінимось.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN SUPERUSER; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA extensions TO anon, authenticated, service_role;

-- ── auth ─────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token text,
  confirmation_sent_at timestamptz,
  recovery_token text,
  recovery_sent_at timestamptz,
  email_change_token_new text,
  email_change text,
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  is_super_admin boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  phone text,
  phone_confirmed_at timestamptz,
  phone_change text,
  phone_change_token text,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
  email_change_token_current text,
  email_change_confirm_status smallint DEFAULT 0,
  banned_until timestamptz,
  reauthentication_token text,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL,
  provider text NOT NULL,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text
);
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz,
  updated_at timestamptz
);

-- Ідентичність запиту емулюється як у PostgREST: через request.jwt.claims.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.email', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON auth.users TO service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.email(), auth.jwt() TO anon, authenticated, service_role;

-- ── storage ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version text,
  owner_id text,
  user_metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts,1)-1];
END $$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[array_length(_parts,1)];
END $$;
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[]; _filename text;
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  SELECT _parts[array_length(_parts,1)] INTO _filename;
  RETURN reverse(split_part(reverse(_filename), '.', 1));
END $$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;

-- ── cron (pg_cron) — заглушка: команди записуються, але ніколи не виконуються ──
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost',
  nodeport int NOT NULL DEFAULT 5432,
  database text NOT NULL DEFAULT 'postgres',
  username text NOT NULL DEFAULT 'postgres',
  active boolean NOT NULL DEFAULT true,
  jobname text
);
CREATE UNIQUE INDEX IF NOT EXISTS cron_job_jobname_idx ON cron.job (jobname) WHERE jobname IS NOT NULL;
CREATE TABLE IF NOT EXISTS cron.job_run_details (
  jobid bigint, runid bigserial PRIMARY KEY, job_pid int, database text, username text,
  command text, status text, return_message text, start_time timestamptz, end_time timestamptz
);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE _id bigint;
BEGIN
  INSERT INTO cron.job (schedule, command, jobname) VALUES (schedule, command, job_name)
  ON CONFLICT (jobname) WHERE jobname IS NOT NULL DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid INTO _id;
  RETURN _id;
END $$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE _id bigint;
BEGIN
  INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid INTO _id;
  RETURN _id;
END $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name; END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobid = job_id;
  RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cron.job j SET
    schedule = COALESCE(alter_job.schedule, j.schedule),
    command  = COALESCE(alter_job.command, j.command),
    active   = COALESCE(alter_job.active, j.active)
  WHERE j.jobid = job_id;
END $$;
GRANT USAGE ON SCHEMA cron TO postgres, service_role;

-- ── net (pg_net) — заглушка: жоден HTTP-запит звідси не виходить ─────────────
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.http_request_queue (
  id bigserial PRIMARY KEY, method text, url text, headers jsonb, body bytea, timeout_milliseconds int
);
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds int DEFAULT 5000) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE _id bigint;
BEGIN
  INSERT INTO net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  VALUES ('POST', url, headers, convert_to(body::text, 'UTF8'), timeout_milliseconds) RETURNING id INTO _id;
  RETURN _id;
END $$;
CREATE OR REPLACE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds int DEFAULT 5000) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE _id bigint;
BEGIN
  INSERT INTO net.http_request_queue (method, url, headers, timeout_milliseconds)
  VALUES ('GET', url, headers, timeout_milliseconds) RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT USAGE ON SCHEMA net TO postgres, service_role, authenticated, anon;

-- ── pgmq — заглушка черги (create/send/read/delete) ─────────────────────────
CREATE SCHEMA IF NOT EXISTS pgmq;
CREATE TABLE IF NOT EXISTS pgmq.meta (queue_name text PRIMARY KEY, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS pgmq.messages (
  msg_id bigserial PRIMARY KEY, queue_name text NOT NULL, read_ct int DEFAULT 0,
  enqueued_at timestamptz DEFAULT now(), vt timestamptz DEFAULT now(), message jsonb
);
CREATE OR REPLACE FUNCTION pgmq.create(queue_name text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO pgmq.meta (queue_name) VALUES (queue_name) ON CONFLICT DO NOTHING
$$;
CREATE OR REPLACE FUNCTION pgmq.send(queue_name text, msg jsonb, delay int DEFAULT 0) RETURNS SETOF bigint LANGUAGE sql AS $$
  INSERT INTO pgmq.messages (queue_name, message, vt) VALUES (queue_name, msg, now() + make_interval(secs => delay)) RETURNING msg_id
$$;
CREATE OR REPLACE FUNCTION pgmq.read(queue_name text, vt int, qty int)
RETURNS TABLE (msg_id bigint, read_ct int, enqueued_at timestamptz, vt timestamptz, message jsonb) LANGUAGE sql AS $$
  SELECT m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message FROM pgmq.messages m
  WHERE m.queue_name = read.queue_name AND m.vt <= now() ORDER BY m.msg_id LIMIT qty
$$;
CREATE OR REPLACE FUNCTION pgmq.delete(queue_name text, msg_id bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM pgmq.messages m WHERE m.queue_name = pgmq.delete.queue_name AND m.msg_id = pgmq.delete.msg_id;
  RETURN FOUND;
END $$;
GRANT USAGE ON SCHEMA pgmq TO postgres, service_role;

-- ── vault — заглушка сховища секретів (значення зберігаються відкрито; це тест) ──
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text DEFAULT '',
  secret text, key_id uuid, nonce bytea, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce, created_at, updated_at FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO vault.secrets (name, description, secret) VALUES (new_name, new_description, new_secret) RETURNING id INTO _id;
  RETURN _id;
END $$;
CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vault.secrets SET secret = COALESCE(new_secret, secret), name = COALESCE(new_name, name),
    description = COALESCE(new_description, description), updated_at = now() WHERE id = secret_id;
END $$;

-- ── realtime — таблиця повідомлень і topic() для політик broadcast ──────────
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE IF NOT EXISTS realtime.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, inserted_at)
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('realtime.topic', true), '')::text
$$;
CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO realtime.messages (payload, event, topic, private, extension) VALUES (payload, event, topic, private, 'broadcast');
END $$;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
GRANT ALL ON realtime.messages TO anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- ── журнал міграцій, як його веде Supabase ──────────────────────────────────
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY, statements text[], name text
);

-- Права за замовчуванням у public — як у Supabase для таблиць і послідовностей.
-- ФУНКЦІЇ: service_role НАВМИСНО не в дефолтах. Прод показав 13.09, що функції,
-- створені пайплайном Lovable, не отримують явного EXECUTE для service_role, і
-- «REVOKE … FROM PUBLIC» лишає edge-функції без прав (confirm-pending-signup →
-- permission denied). Стенд мусить бути не мʼякшим за прод: право service_role
-- на RPC тут існує лише через PUBLIC або явний GRANT (як у 20260913090000).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
