-- ============================================================================
-- П1.3 (вердикт 31.08, останній чатовий хвіст Б2): менеджер більше не відкриває
-- чати ЧУЖОГО бізнесу.
--
-- Було: get_or_create_chat_thread пускав будь-якого менеджера до будь-якої
-- пари з відносинами — включно з парами САМОСТІЙНОГО репетитора та його
-- учнів. Школа не сторона цих розмов: у незалежного свої учні і свої гроші.
--
-- Стало: менеджер, який НЕ є учасником треду, може відкрити пару лише коли
-- її репетитор не самостійний (independent_workspace <> true) — тобто пару
-- школи. Support-треди (одна зі сторін — менеджер) працюють як раніше;
-- модерація суперадміна йде своїм гейтом (is_superadmin, RLS) і цієї функції
-- не потребує.
--
-- LIVE-MARKER-NONE: перевипуск функції з тією самою сигнатурою — форма
-- types.ts не змінюється. Перевірка вручну: менеджер викликає
-- get_or_create_chat_thread(_tutor_id=<незалежний>, _student_id=<його учень>)
-- і отримує помилку 'Not allowed to access this chat', а для хабової пари —
-- id треду, як раніше.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_or_create_chat_thread(_tutor_id uuid, _student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _thread_id uuid;
  _is_manager boolean;
  _caller_is_party boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);
  _caller_is_party := (auth.uid() = _tutor_id OR auth.uid() = _student_id);

  -- Caller must be one of the participants OR a manager
  IF NOT _is_manager AND NOT _caller_is_party THEN
    RAISE EXCEPTION 'Not allowed to access this chat';
  END IF;

  -- П1.3: менеджер поза тредом — лише до пар ШКОЛИ. Пара самостійного
  -- репетитора (independent_workspace = true) для чужого менеджера закрита,
  -- окрім support-тредів, де однією зі сторін є менеджер.
  IF _is_manager AND NOT _caller_is_party THEN
    IF EXISTS (
         SELECT 1 FROM public.tutor_workspace_settings t
         WHERE t.tutor_id = _tutor_id AND t.independent_workspace = true
       )
       AND NOT public.has_role(_tutor_id, 'manager'::app_role)
       AND NOT public.has_role(_student_id, 'manager'::app_role) THEN
      RAISE EXCEPTION 'Not allowed to access this chat';
    END IF;
  END IF;

  -- Verify the pair has a real relationship: individual lesson, rate, GROUP lesson
  -- participation, GROUP enrollment, OR one side is a manager (support thread).
  IF NOT EXISTS (SELECT 1 FROM public.lessons WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_rates WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.lesson_participants lp
       JOIN public.lessons l ON l.id = lp.lesson_id
       WHERE l.tutor_id = _tutor_id AND lp.student_id = _student_id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.group_enrollments ge
       JOIN public.lesson_groups g ON g.id = ge.group_id
       WHERE g.tutor_id = _tutor_id AND ge.student_id = _student_id
     )
     AND NOT public.has_role(_student_id, 'manager'::app_role)
     AND NOT public.has_role(_tutor_id, 'manager'::app_role) THEN
    RAISE EXCEPTION 'No active relationship between this tutor and student';
  END IF;

  SELECT id INTO _thread_id FROM public.chat_threads
  WHERE tutor_id = _tutor_id AND student_id = _student_id;

  IF _thread_id IS NULL THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
    VALUES (_tutor_id, _student_id)
    RETURNING id INTO _thread_id;
  END IF;

  RETURN _thread_id;
END;
$$;
