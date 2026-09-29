CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope    text NOT NULL,
  key_hash text NOT NULL,
  hit_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rate_limit_hits IS
  'Спроби публічних edge-функцій для лімітів (ключ лише md5, живуть добу). Пише лише rate_limit_check.';
CREATE INDEX IF NOT EXISTS rate_limit_hits_scope_key_at_idx ON public.rate_limit_hits (scope, key_hash, hit_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_hits_hit_at_idx ON public.rate_limit_hits (hit_at);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_hits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limit_hits TO service_role;

CREATE OR REPLACE FUNCTION public.rate_limit_check(_scope text, _key text, _max integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _h text;
  _n integer;
BEGIN
  IF coalesce(_scope, '') = '' OR coalesce(_key, '') = ''
     OR coalesce(_max, 0) < 1 OR coalesce(_window_seconds, 0) < 1 OR _window_seconds > 86400 THEN
    RAISE EXCEPTION 'RATE_LIMIT_BAD_ARGS' USING ERRCODE = 'check_violation';
  END IF;
  _h := md5(_scope || chr(10) || lower(trim(_key)));
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limit_hits WHERE hit_at < now() - interval '1 day';
  END IF;
  INSERT INTO public.rate_limit_hits (scope, key_hash) VALUES (_scope, _h);
  SELECT count(*) INTO _n
    FROM public.rate_limit_hits
   WHERE scope = _scope AND key_hash = _h
     AND hit_at > now() - make_interval(secs => _window_seconds);
  RETURN _n > _max;
END $$;
REVOKE EXECUTE ON FUNCTION public.rate_limit_check(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id
    FROM auth.users u
   WHERE coalesce(trim(_email), '') <> ''
     AND lower(u.email) = lower(trim(_email))
   ORDER BY u.created_at
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_by_email(text) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_pending_profile(_real_id uuid, _email text, _phone text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ghost_id uuid;
  _ghost_email text;
  _ghost_phone text;
BEGIN
  SELECT p.id, c.email, c.phone
    INTO _ghost_id, _ghost_email, _ghost_phone
  FROM public.profiles p
  JOIN public.profile_contacts c ON c.user_id = p.id
  WHERE p.is_pending = true
    AND (
      (_email IS NOT NULL AND _email <> '' AND lower(c.email) = lower(_email))
      OR (_phone IS NOT NULL AND _phone <> '' AND c.phone = _phone AND coalesce(c.email, '') = '')
    )
  LIMIT 1;
  IF _ghost_id IS NULL OR _ghost_id = _real_id THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.pending_profile_merge', 'on', true);
  UPDATE public.lessons SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.lessons SET student_id = _real_id WHERE student_id = _ghost_id;
  UPDATE public.lessons SET created_by = _real_id WHERE created_by = _ghost_id;
  UPDATE public.student_rates SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.student_rates SET student_id = _real_id WHERE student_id = _ghost_id;
  UPDATE public.tutor_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_details WHERE user_id = _real_id);
  DELETE FROM public.tutor_details WHERE user_id = _ghost_id;
  UPDATE public.student_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.student_details WHERE user_id = _real_id);
  DELETE FROM public.student_details WHERE user_id = _ghost_id;
  UPDATE public.tutor_workspace_settings SET tutor_id = _real_id
    WHERE tutor_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE tutor_id = _real_id);
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _ghost_id;
  INSERT INTO public.hub_members (hub_id, user_id)
  SELECT hub_id, _real_id FROM public.hub_members WHERE user_id = _ghost_id
  ON CONFLICT DO NOTHING;
  DELETE FROM public.hub_members WHERE user_id = _ghost_id;
  INSERT INTO public.user_roles (user_id, role)
  SELECT _real_id, role FROM public.user_roles WHERE user_id = _ghost_id
  ON CONFLICT (user_id, role) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = _ghost_id;
  UPDATE public.profiles r
    SET first_name = COALESCE(NULLIF(r.first_name, ''), g.first_name),
        last_name  = COALESCE(NULLIF(r.last_name, ''),  g.last_name)
    FROM public.profiles g
    WHERE r.id = _real_id AND g.id = _ghost_id;
  DELETE FROM public.profile_contacts c
    WHERE c.user_id <> _real_id
      AND (
        c.user_id = _ghost_id
        OR (
          _email IS NOT NULL AND _email <> '' AND lower(c.email) = lower(_email)
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.user_id AND p.is_pending = true)
        )
      );
  INSERT INTO public.profile_contacts (user_id, email, phone)
  VALUES (_real_id, COALESCE(NULLIF(_email, ''), _ghost_email), COALESCE(NULLIF(_phone, ''), _ghost_phone))
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
        phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);
  DELETE FROM public.profiles WHERE id = _ghost_id;
  PERFORM set_config('app.pending_profile_merge', '', true);
  RETURN _ghost_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merging boolean := COALESCE(current_setting('app.pending_profile_merge', true), '') = 'on';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT _merging AND NEW.tutor_id IS DISTINCT FROM OLD.tutor_id THEN
      RAISE EXCEPTION 'tutor_id is immutable';
    END IF;
    IF NOT _merging AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'student_id is immutable';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'lesson source is immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE _limited boolean;
BEGIN
  IF NOT has_function_privilege('service_role', 'public.rate_limit_check(text, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role не може викликати rate_limit_check';
  END IF;
  IF has_function_privilege('anon', 'public.rate_limit_check(text, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.user_id_by_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon має право на службові функції';
  END IF;
  IF public.rate_limit_check('selfcheck', 'x', 1, 60) THEN
    RAISE EXCEPTION 'перша спроба вже «забагато»';
  END IF;
  _limited := public.rate_limit_check('selfcheck', 'x', 1, 60);
  IF NOT _limited THEN
    RAISE EXCEPTION 'ліміт не працює';
  END IF;
  DELETE FROM public.rate_limit_hits WHERE scope = 'selfcheck';
  IF position('pending_profile_merge' in (SELECT prosrc FROM pg_proc WHERE proname = 'protect_lesson_fields' LIMIT 1)) = 0 THEN
    RAISE EXCEPTION 'protect_lesson_fields не знає прапорця злиття';
  END IF;
  RAISE NOTICE 'публічні двері ✔';
END $$;

CREATE TABLE IF NOT EXISTS public.ai_calls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id   uuid NOT NULL,
  lesson_id  uuid,
  kind       text NOT NULL,
  input_hash text NOT NULL,
  status     text NOT NULL CHECK (status IN ('ok', 'error', 'cached', 'limited', 'too_little', 'rejected')),
  model      text,
  ms         integer,
  output     text,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_tutor_day_idx ON public.ai_calls (tutor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_calls_cache_idx ON public.ai_calls (tutor_id, kind, input_hash, created_at DESC) WHERE status = 'ok';
ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_calls FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_calls TO service_role;

CREATE OR REPLACE FUNCTION public.ai_call_gate(_tutor uuid, _kind text, _input_hash text, _max_per_day integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _today  integer;
  _cached text;
BEGIN
  IF _tutor IS NULL OR coalesce(_kind, '') = '' OR coalesce(_input_hash, '') = '' OR coalesce(_max_per_day, 0) < 1 THEN
    RAISE EXCEPTION 'AI_GATE_BAD_ARGS' USING ERRCODE = 'check_violation';
  END IF;
  SELECT output INTO _cached
    FROM public.ai_calls
   WHERE tutor_id = _tutor AND kind = _kind AND input_hash = _input_hash
     AND status = 'ok' AND output IS NOT NULL
     AND created_at > now() - interval '7 days'
   ORDER BY created_at DESC
   LIMIT 1;
  SELECT count(*) INTO _today
    FROM public.ai_calls
   WHERE tutor_id = _tutor AND kind = _kind
     AND status IN ('ok', 'error')
     AND created_at > now() - interval '1 day';
  RETURN jsonb_build_object(
    'allowed', _today < _max_per_day,
    'calls_today', _today,
    'cached', _cached
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.ai_call_gate(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_call_gate(uuid, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_call_log(
  _tutor uuid, _lesson uuid, _kind text, _input_hash text, _status text,
  _ms integer DEFAULT NULL, _model text DEFAULT NULL, _output text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF random() < 0.02 THEN
    DELETE FROM public.ai_calls WHERE created_at < now() - interval '90 days';
  END IF;
  INSERT INTO public.ai_calls (tutor_id, lesson_id, kind, input_hash, status, ms, model, output, error)
  VALUES (_tutor, _lesson, _kind, _input_hash, _status, _ms, _model,
          left(_output, 4000), left(_error, 1000))
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.ai_call_log(uuid, uuid, text, text, text, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_call_log(uuid, uuid, text, text, text, integer, text, text, text) TO service_role;

DO $$
DECLARE
  _t uuid := gen_random_uuid();
  _g jsonb;
BEGIN
  IF NOT has_function_privilege('service_role', 'public.ai_call_gate(uuid, text, text, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ai_call_log(uuid, uuid, text, text, text, integer, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role не може кликати ai_call_gate/ai_call_log';
  END IF;
  IF has_function_privilege('authenticated', 'public.ai_call_gate(uuid, text, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ai_call_gate доступна з браузера';
  END IF;
  _g := public.ai_call_gate(_t, 'selfcheck', 'h1', 1);
  IF (_g->>'allowed')::boolean IS NOT TRUE OR _g->>'cached' IS NOT NULL THEN
    RAISE EXCEPTION 'перший виклик: %', _g;
  END IF;
  PERFORM public.ai_call_log(_t, NULL, 'selfcheck', 'h1', 'ok', 100, 'm', 'ТЕМА', NULL);
  _g := public.ai_call_gate(_t, 'selfcheck', 'h1', 1);
  IF (_g->>'allowed')::boolean IS NOT FALSE OR _g->>'cached' <> 'ТЕМА' THEN
    RAISE EXCEPTION 'після виклику: %', _g;
  END IF;
  DELETE FROM public.ai_calls WHERE tutor_id = _t;
  RAISE NOTICE 'AI під наглядом ✔';
END $$;

CREATE TABLE IF NOT EXISTS public.job_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job         text NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  ms          integer,
  ok          boolean NOT NULL,
  status      integer,
  counts      jsonb,
  error       text
);
CREATE INDEX IF NOT EXISTS job_runs_job_started_idx ON public.job_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_started_idx ON public.job_runs (started_at);
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_runs TO service_role;

CREATE OR REPLACE FUNCTION public.job_run_record(
  _job text, _ok boolean, _ms integer, _status integer DEFAULT NULL,
  _counts jsonb DEFAULT NULL, _error text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF coalesce(_job, '') = '' OR _ok IS NULL THEN
    RAISE EXCEPTION 'JOB_RUN_BAD_ARGS' USING ERRCODE = 'check_violation';
  END IF;
  IF random() < 0.02 THEN
    DELETE FROM public.job_runs WHERE started_at < now() - interval '30 days';
  END IF;
  INSERT INTO public.job_runs (job, started_at, finished_at, ms, ok, status, counts, error)
  VALUES (_job, now() - make_interval(secs => greatest(coalesce(_ms, 0), 0) / 1000.0), now(),
          _ms, _ok, _status, _counts, left(_error, 1000))
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.job_run_record(text, boolean, integer, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_run_record(text, boolean, integer, integer, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.job_health(_hours integer DEFAULT 26)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.job), '[]'::jsonb)
  FROM (
    SELECT r.job,
           count(*)                        AS runs,
           count(*) FILTER (WHERE NOT r.ok) AS failures,
           max(r.finished_at) FILTER (WHERE r.ok) AS last_ok_at,
           max(r.finished_at)              AS last_run_at,
           (SELECT x.error  FROM public.job_runs x WHERE x.job = r.job AND NOT x.ok ORDER BY x.finished_at DESC LIMIT 1) AS last_error,
           (SELECT x.counts FROM public.job_runs x WHERE x.job = r.job AND x.ok ORDER BY x.finished_at DESC LIMIT 1) AS last_counts
      FROM public.job_runs r
     WHERE r.started_at > now() - make_interval(hours => greatest(coalesce(_hours, 26), 1))
     GROUP BY r.job
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public.job_health(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_health(integer) TO service_role;

DO $$
DECLARE _h jsonb;
BEGIN
  IF NOT has_function_privilege('service_role', 'public.job_run_record(text, boolean, integer, integer, jsonb, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.job_health(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role не може писати/читати журнал запусків';
  END IF;
  IF has_function_privilege('authenticated', 'public.job_health(integer)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.job_runs', 'SELECT') THEN
    RAISE EXCEPTION 'журнал запусків видно з браузера';
  END IF;
  PERFORM public.job_run_record('selfcheck', true, 120, 200, '{"sent": 3}'::jsonb, NULL);
  PERFORM public.job_run_record('selfcheck', false, 50, 500, NULL, 'boom');
  _h := public.job_health(1);
  IF jsonb_array_length(_h) < 1
     OR (_h->0->>'runs')::int <> 2 OR (_h->0->>'failures')::int <> 1
     OR _h->0->>'last_error' <> 'boom' OR (_h->0->'last_counts'->>'sent')::int <> 3 THEN
    RAISE EXCEPTION 'job_health рахує неправильно: %', _h;
  END IF;
  DELETE FROM public.job_runs WHERE job = 'selfcheck';
  RAISE NOTICE 'мертвий вимикач ✔';
END $$;

CREATE TABLE IF NOT EXISTS public.pending_invite_tokens (
  profile_id uuid PRIMARY KEY,
  token      text NOT NULL UNIQUE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  used_at    timestamptz
);
ALTER TABLE public.pending_invite_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pending_invite_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pending_invite_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.issue_invite_token(_profile uuid, _email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t text;
BEGIN
  IF _profile IS NULL OR coalesce(trim(_email), '') = '' THEN
    RAISE EXCEPTION 'INVITE_TOKEN_BAD_ARGS' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _profile AND is_pending = true) THEN
    RAISE EXCEPTION 'INVITE_TOKEN_NOT_PENDING' USING ERRCODE = 'check_violation';
  END IF;
  _t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.pending_invite_tokens (profile_id, token, email)
  VALUES (_profile, _t, lower(trim(_email)))
  ON CONFLICT (profile_id) DO UPDATE
    SET token = EXCLUDED.token, email = EXCLUDED.email,
        created_at = now(), expires_at = now() + interval '30 days', used_at = NULL;
  RETURN _t;
END $$;
REVOKE EXECUTE ON FUNCTION public.issue_invite_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invite_token(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_invite_token(_token text, _email text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF coalesce(_token, '') = '' OR coalesce(trim(_email), '') = '' THEN
    RETURN false;
  END IF;
  UPDATE public.pending_invite_tokens t
     SET used_at = now()
   WHERE t.token = _token
     AND t.email = lower(trim(_email))
     AND t.used_at IS NULL
     AND t.expires_at > now()
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.profile_id AND p.is_pending = true);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END $$;
REVOKE EXECUTE ON FUNCTION public.consume_invite_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invite_token(text, text) TO service_role;

DO $$
DECLARE
  _p uuid := gen_random_uuid();
  _t text;
BEGIN
  IF has_function_privilege('anon', 'public.consume_invite_token(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_invite_token(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ключі запрошень доступні з браузера';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.consume_invite_token(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role не може гасити ключ';
  END IF;
  INSERT INTO public.profiles (id, first_name, last_name, is_pending) VALUES (_p, 'Self', 'Check', true);
  _t := public.issue_invite_token(_p, 'Self.Check@Test.local');
  IF length(_t) < 60 THEN RAISE EXCEPTION 'ключ закороткий: %', _t; END IF;
  IF public.consume_invite_token(_t, 'other@test.local') THEN RAISE EXCEPTION 'ключ прийнято з чужою поштою'; END IF;
  IF NOT public.consume_invite_token(_t, 'self.check@test.local') THEN RAISE EXCEPTION 'живий ключ не прийнято'; END IF;
  IF public.consume_invite_token(_t, 'self.check@test.local') THEN RAISE EXCEPTION 'ключ спрацював двічі'; END IF;
  DELETE FROM public.pending_invite_tokens WHERE profile_id = _p;
  DELETE FROM public.profiles WHERE id = _p;
  RAISE NOTICE 'ключ у листі-запрошенні ✔';
END $$;

CREATE OR REPLACE FUNCTION public.enforce_core_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> NEW.tutor_id THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'lessons' THEN
    IF coalesce(to_jsonb(NEW)->>'source', '') <> 'independent' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'student_wallet_transactions' THEN
    IF coalesce(to_jsonb(NEW)->>'kind', '') <> 'topup' THEN RETURN NEW; END IF;
  END IF;
  IF public.is_independent_tutor(NEW.tutor_id) AND NOT public.is_tutor_pro(NEW.tutor_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: потрібна активна підписка або тріал — відкрийте «Підписка» у профілі'
      USING ERRCODE = 'insufficient_privilege', HINT = 'core_lock';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_00_core_lock ON public.lessons;
CREATE TRIGGER trg_00_core_lock
  BEFORE INSERT ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_core_lock();

DROP TRIGGER IF EXISTS trg_00_core_lock ON public.student_wallet_transactions;
CREATE TRIGGER trg_00_core_lock
  BEFORE INSERT ON public.student_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_core_lock();

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_00_core_lock' AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'замок на сервері не стоїть на обох таблицях';
  END IF;
  RAISE NOTICE 'замок на сервері ✔';
END $$;