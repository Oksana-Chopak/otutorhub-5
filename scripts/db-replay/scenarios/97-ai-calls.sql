-- Сценарій: AI під наглядом (27.09) — журнал, стеля на добу і кеш для AI-конспекту.
-- (1) стеля 2 на добу: два справжні виклики проходять, третій — «не можна»;
-- (2) кеш: ті самі вхідні дані за 7 днів повертають збережений текст без виклику;
-- (3) відмови, кеш і «замало даних» стелі не зʼїдають — рахуються лише ok/error;
-- (4) інший репетитор має свою стелю і не бачить чужого кешу;
-- (5) з браузера (authenticated) ні журнал, ні стелю не викликати.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  l1 uuid := gen_random_uuid();
  g jsonb;
BEGIN
  -- ── (1) стеля ─────────────────────────────────────────────────────────────
  g := public.ai_call_gate(t1, 'lesson_summary', 'h-a', 2);
  IF (g->>'allowed')::boolean IS NOT TRUE OR (g->>'calls_today')::int <> 0 THEN
    RAISE EXCEPTION '(1) свіжий репетитор мусить мати 0 викликів і дозвіл: %', g;
  END IF;
  PERFORM public.ai_call_log(t1, l1, 'lesson_summary', 'h-a', 'ok', 900, 'google/gemini-2.5-flash', 'Тема A' || chr(10) || 'ЩО ПРОЙШЛИ' || chr(10) || '• Пункт', NULL);
  PERFORM public.ai_call_log(t1, l1, 'lesson_summary', 'h-b', 'error', 25000, 'google/gemini-2.5-flash', NULL, 'timeout');
  g := public.ai_call_gate(t1, 'lesson_summary', 'h-c', 2);
  IF (g->>'allowed')::boolean IS NOT FALSE OR (g->>'calls_today')::int <> 2 THEN
    RAISE EXCEPTION '(1) після двох викликів (ok + error) при стелі 2 мусить бути відмова: %', g;
  END IF;
  RAISE NOTICE '✅ (1) стеля на добу: 2 виклики (ok + помилка) → третій не пускаємо';

  -- ── (2) кеш ───────────────────────────────────────────────────────────────
  g := public.ai_call_gate(t1, 'lesson_summary', 'h-a', 20);
  IF g->>'cached' IS NULL OR g->>'cached' NOT LIKE 'Тема A%' THEN
    RAISE EXCEPTION '(2) ті самі вхідні дані мусять повертати кеш: %', g;
  END IF;
  g := public.ai_call_gate(t1, 'lesson_summary', 'h-b', 20);
  IF g->>'cached' IS NOT NULL THEN
    RAISE EXCEPTION '(2) помилковий виклик не має ставати кешем: %', g;
  END IF;
  RAISE NOTICE '✅ (2) кеш: той самий урок з тими самими даними — без нового виклику; помилка кешем не стає';

  -- ── (3) що не зʼїдає стелю ────────────────────────────────────────────────
  PERFORM public.ai_call_log(t1, l1, 'lesson_summary', 'h-a', 'cached', 5, NULL, NULL, NULL);
  PERFORM public.ai_call_log(t1, l1, 'lesson_summary', 'h-d', 'too_little', 1, NULL, NULL, NULL);
  PERFORM public.ai_call_log(t1, l1, 'lesson_summary', 'h-e', 'limited', 1, NULL, NULL, NULL);
  PERFORM public.ai_call_log(t1, l1, 'lesson_summary', 'h-f', 'rejected', 800, 'google/gemini-2.5-flash', 'Quadratic', 'not_ukrainian');
  g := public.ai_call_gate(t1, 'lesson_summary', 'h-z', 20);
  IF (g->>'calls_today')::int <> 2 THEN
    RAISE EXCEPTION '(3) кеш/замало/відмова/відхилено не мали рахуватись, маємо %', g->>'calls_today';
  END IF;
  RAISE NOTICE '✅ (3) кеш, «замало даних», ліміт і відхилена відповідь стелі не зʼїдають';

  -- ── (4) інший репетитор ───────────────────────────────────────────────────
  g := public.ai_call_gate(t2, 'lesson_summary', 'h-a', 2);
  IF (g->>'allowed')::boolean IS NOT TRUE OR g->>'cached' IS NOT NULL THEN
    RAISE EXCEPTION '(4) інший репетитор успадкував чужу стелю або кеш: %', g;
  END IF;
  RAISE NOTICE '✅ (4) стеля і кеш — на репетитора, чужого не видно';

  -- ── (5) з браузера не викликати ───────────────────────────────────────────
  IF has_function_privilege('authenticated', 'public.ai_call_gate(uuid, text, text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ai_call_log(uuid, uuid, text, text, text, integer, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ai_call_gate(uuid, text, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '(5) журнал AI доступний з браузера — стелю можна обнулити або читати чужі конспекти';
  END IF;
  IF has_table_privilege('authenticated', 'public.ai_calls', 'SELECT') THEN
    RAISE EXCEPTION '(5) таблицю ai_calls видно з браузера';
  END IF;
  RAISE NOTICE '✅ (5) журнал і стеля — лише для service_role';
END $$;

ROLLBACK;
