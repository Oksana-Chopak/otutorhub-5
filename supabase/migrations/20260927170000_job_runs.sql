-- ═══════════════════════════════════════════════════════════════════════════
-- Мертвий вимикач (27.09): журнал нічних і погодинних процесів.
--
-- Що було: 12 edge-функцій запускаються pg_cron → net.http_post «вистрелив і
-- забув». Якщо дайджест, нагадування чи бекап упали — не дізнається ніхто:
-- логи Supabase не бачать ні власниця, ні агент; робот уранці перевіряє екрани,
-- а не «чи прийшов учора дайджест 40 репетиторам». Клас уже коштував тижня
-- (13.09: нагадування мовчали при «успішному» кроні).
--
-- Що тепер:
--   • `job_runs` — один рядок на запуск: назва, тривалість, ok/ні, HTTP-статус,
--     лічильники з відповіді функції (скільки надіслано), текст помилки.
--     Пише лише service_role через `job_run_record` (обгортка `withJob` у
--     `_shared/jobRun.ts`). Рядки старші за 30 днів прибираються самі.
--   • `job_health(hours)` — зведення для ранкового дайджесту суперадміна:
--     по кожному процесу — коли востаннє був успішним, скільки запусків і
--     провалів, остання помилка й останні лічильники. Нуль там, де вчора було
--     сорок, — це тривога, яку видно з телефона.
-- Бізнес: мовчазний збій нічного процесу = клієнт без нагадувань, без дайджесту,
-- без бекапу — і дізнаємось про це від клієнта через тиждень.
-- Ідемпотентна. LIVE-MARKER: `job_run_record` у types.ts (і таблиця `job_runs`, `job_health`).
-- ═══════════════════════════════════════════════════════════════════════════

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
COMMENT ON TABLE public.job_runs IS
  'Журнал запусків cron-функцій (мертвий вимикач). Пише лише withJob через job_run_record; читає дайджест суперадміна через job_health.';
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

-- Зведення за останні N годин: масив об'єктів по процесах.
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
    RAISE EXCEPTION 'service_role не може писати/читати журнал запусків — мертвий вимикач не запрацює';
  END IF;
  IF has_function_privilege('authenticated', 'public.job_health(integer)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.job_runs', 'SELECT') THEN
    RAISE EXCEPTION 'журнал запусків видно з браузера — так не має бути';
  END IF;
  PERFORM public.job_run_record('selfcheck', true, 120, 200, '{"sent": 3}'::jsonb, NULL);
  PERFORM public.job_run_record('selfcheck', false, 50, 500, NULL, 'boom');
  _h := public.job_health(1);
  IF jsonb_array_length(_h) < 1
     OR (_h->0->>'runs')::int <> 2 OR (_h->0->>'failures')::int <> 1
     OR _h->0->>'last_error' <> 'boom' OR (_h->0->'last_counts'->>'sent')::int <> 3 THEN
    RAISE EXCEPTION 'зведення job_health рахує неправильно: %', _h;
  END IF;
  DELETE FROM public.job_runs WHERE job = 'selfcheck';
  RAISE NOTICE 'мертвий вимикач: журнал запусків і зведення працюють, лише для service_role ✔';
END $$;
