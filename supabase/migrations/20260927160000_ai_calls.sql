-- ═══════════════════════════════════════════════════════════════════════════
-- AI під наглядом (27.09): журнал і ліміт викликів моделі.
--
-- Що було: кнопка «AI-конспект» кликала модель без стелі (кожен дотик — кредити
-- Lovable), без кешу (той самий урок — новий виклик), без таймауту, без сліду
-- (скільки викликів, скільки відмов, скільки коштує — невідомо нікому).
--
-- Що тепер:
--   • `ai_calls` — кожен виклик: хто, який урок, хеш вхідних даних, статус,
--     тривалість, модель, результат або помилка. Читає лише service_role
--     (у дайджест суперадміна йде лише зведення — «Мертвий вимикач»);
--   • `ai_call_gate(tutor, kind, hash, max/день)` → {allowed, calls_today, cached}:
--     стеля на репетитора на добу і кеш на 7 днів — повторний дотик по тому ж
--     уроку безкоштовний;
--   • `ai_call_log(...)` — запис результату. Рядки старші за 90 днів
--     прибираються самі.
-- Бізнес: AI-конспект — платна фіча повного плану; без стелі один зациклений
-- клієнт (або скрипт) спалює кредити всіх, без журналу вартість невидима.
-- ═══════════════════════════════════════════════════════════════════════════

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
COMMENT ON TABLE public.ai_calls IS
  'Журнал викликів AI (конспекти): ліміт на добу, кеш на 7 днів, облік вартості. Лише service_role.';
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
  -- Кеш: та сама людина, той самий урок з тими самими даними за 7 днів.
  SELECT output INTO _cached
    FROM public.ai_calls
   WHERE tutor_id = _tutor AND kind = _kind AND input_hash = _input_hash
     AND status = 'ok' AND output IS NOT NULL
     AND created_at > now() - interval '7 days'
   ORDER BY created_at DESC
   LIMIT 1;
  -- Рахуємо лише справжні виклики моделі (ok + error); кеш, відмови й
  -- «замало даних» стелі не зʼїдають.
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
    RAISE EXCEPTION 'service_role не може кликати ai_call_gate/ai_call_log — AI-конспект лишиться без ліміту й журналу';
  END IF;
  IF has_function_privilege('authenticated', 'public.ai_call_gate(uuid, text, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ai_call_gate доступна з браузера — так не має бути';
  END IF;
  _g := public.ai_call_gate(_t, 'selfcheck', 'h1', 1);
  IF (_g->>'allowed')::boolean IS NOT TRUE OR _g->>'cached' IS NOT NULL THEN
    RAISE EXCEPTION 'перший виклик мусить бути дозволений і без кешу: %', _g;
  END IF;
  PERFORM public.ai_call_log(_t, NULL, 'selfcheck', 'h1', 'ok', 100, 'm', 'ТЕМА', NULL);
  _g := public.ai_call_gate(_t, 'selfcheck', 'h1', 1);
  IF (_g->>'allowed')::boolean IS NOT FALSE OR _g->>'cached' <> 'ТЕМА' THEN
    RAISE EXCEPTION 'після одного виклику при стелі 1 мусить бути «не можна» і кеш: %', _g;
  END IF;
  DELETE FROM public.ai_calls WHERE tutor_id = _t;
  RAISE NOTICE 'AI під наглядом: журнал, стеля на добу і кеш працюють ✔';
END $$;
