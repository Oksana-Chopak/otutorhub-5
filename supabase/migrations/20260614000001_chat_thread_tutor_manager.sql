-- Allow a tutor↔manager "support" chat thread.
--
-- chat_threads is a generic (tutor_id, student_id) pair. A tutor messaging the
-- hub manager has no lesson/student_rate relationship, so get_or_create_chat_thread
-- previously raised 'No active relationship'. This widens the relationship check
-- to also permit a thread when one of the participants is a manager.
--
-- Scope of change: ONLY this SECURITY DEFINER function. Because it is SECURITY
-- DEFINER, its INSERT bypasses the chat_threads INSERT RLS policy, so no policy
-- change is needed. SELECT on chat_threads already allows the tutor (own thread)
-- and the manager (Manager views all threads). chat_messages SELECT/INSERT key
-- off thread participation (tutor_id/student_id), which both parties satisfy.
-- The profiles SELECT policy already grants read once a chat_thread exists
-- between the two users, so the tutor can read the manager's profile afterwards.
-- Existing tutor↔student behavior is unchanged (still requires lesson or rate).

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

  -- Verify the pair has a real relationship (lesson or rate), OR one side is a
  -- manager (tutor↔manager / student↔manager support thread).
  IF NOT EXISTS (SELECT 1 FROM public.lessons WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_rates WHERE tutor_id = _tutor_id AND student_id = _student_id)
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

-- Self-contained entry point for the "Менеджер хабу" button.
-- A tutor cannot read user_roles to discover the single manager (RLS limits
-- SELECT to own roles), so this SECURITY DEFINER function resolves the manager,
-- ensures the tutor↔manager thread exists, and returns the manager's user id.
-- The frontend then navigates to /chats?with={manager} and the existing
-- "thread already exists" path selects it.
CREATE OR REPLACE FUNCTION public.start_manager_chat()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _manager uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  -- The hub has a single manager account.
  SELECT user_id INTO _manager
  FROM public.user_roles
  WHERE role = 'manager'::app_role
  ORDER BY user_id
  LIMIT 1;

  IF _manager IS NULL THEN
    RAISE EXCEPTION 'No manager account';
  END IF;

  -- Manager opening their own contact — nothing to create.
  IF _manager = _me THEN
    RETURN _manager;
  END IF;

  -- Ensure the tutor↔manager thread (tutor = caller, manager in student slot).
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_threads WHERE tutor_id = _me AND student_id = _manager
  ) THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
    VALUES (_me, _manager);
  END IF;

  RETURN _manager;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_manager_chat() TO authenticated;
