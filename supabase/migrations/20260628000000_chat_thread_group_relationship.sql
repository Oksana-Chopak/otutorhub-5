-- Allow a tutor<->student chat thread when their only connection is a GROUP lesson.
--
-- Bug (reported from manual testing): a student whose lessons with a tutor are all
-- GROUP lessons has no public.student_rates row and no individual public.lessons
-- row (group lessons store lessons.student_id = NULL and link students via
-- public.lesson_participants). So get_or_create_chat_thread raised
-- 'No active relationship between this tutor and student', and the student's
-- "tap chat to reach the tutor" flow dead-ended on the empty
-- "Чати чекають на старт" state — the chat was never created.
--
-- Fix: widen the relationship check to ALSO accept a group connection:
--   * the student is a participant (lesson_participants) of a lesson owned by the tutor, OR
--   * the student is enrolled (group_enrollments) in a lesson_group owned by the tutor.
--
-- Scope: ONLY this SECURITY DEFINER function changes, and it only WIDENS the set of
-- permitted pairs (adds two OR-ed EXISTS checks). Individual tutor<->student
-- (lesson/rate) and tutor<->manager support threads behave exactly as before. No RLS
-- policy change is needed (the function is SECURITY DEFINER; chat_threads/chat_messages
-- SELECT already key off thread participation).
--
-- Timestamp 20260628000000 is strictly above the latest applied migration so the
-- runner will not silently skip it (project ordering rule).

CREATE OR REPLACE FUNCTION public.get_or_create_chat_thread(_tutor_id uuid, _student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _thread_id uuid;
  _is_manager boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);

  -- Caller must be one of the participants OR a manager
  IF NOT _is_manager AND auth.uid() <> _tutor_id AND auth.uid() <> _student_id THEN
    RAISE EXCEPTION 'Not allowed to access this chat';
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
