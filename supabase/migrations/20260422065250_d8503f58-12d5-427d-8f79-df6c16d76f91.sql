-- 1. chat_threads: one private thread per tutor+student pair
CREATE TABLE public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_message_preview text,
  CONSTRAINT chat_threads_pair_unique UNIQUE (tutor_id, student_id)
);

CREATE INDEX idx_chat_threads_tutor ON public.chat_threads(tutor_id);
CREATE INDEX idx_chat_threads_student ON public.chat_threads(student_id);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

-- Participants and managers can view
CREATE POLICY "Participants view own threads"
  ON public.chat_threads FOR SELECT
  TO authenticated
  USING (auth.uid() = tutor_id OR auth.uid() = student_id);

CREATE POLICY "Manager views all threads"
  ON public.chat_threads FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

-- Insert: a participant can create the thread for themselves only if a real pair exists
CREATE POLICY "Participant creates own thread"
  ON public.chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = tutor_id OR auth.uid() = student_id)
    AND (
      EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = chat_threads.tutor_id AND l.student_id = chat_threads.student_id)
      OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = chat_threads.tutor_id AND r.student_id = chat_threads.student_id)
    )
  );

CREATE POLICY "Manager creates any thread"
  ON public.chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

-- Update: only system trigger should set last_message_*; allow participants to touch updated_at
CREATE POLICY "Participants update own thread"
  ON public.chat_threads FOR UPDATE
  TO authenticated
  USING (auth.uid() = tutor_id OR auth.uid() = student_id OR public.has_role(auth.uid(), 'manager'::app_role));


-- 2. chat_messages
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_thread_created ON public.chat_messages(thread_id, created_at DESC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- View: participants of the thread, or manager
CREATE POLICY "Participants view thread messages"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = chat_messages.thread_id
        AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
    )
  );

CREATE POLICY "Manager views all messages"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

-- Insert: only the two participants can send; sender must be themselves; manager CANNOT post
CREATE POLICY "Participant sends message"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = chat_messages.thread_id
        AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
    )
  );

-- Edits/deletes: forbidden (no UPDATE/DELETE policies = denied). Audit trail intact.


-- 3. Trigger to update thread last_message_* on new message
CREATE OR REPLACE FUNCTION public.touch_chat_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_threads
  SET last_message_at = NEW.created_at,
      last_message_preview = left(NEW.body, 200),
      updated_at = NEW.created_at
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_chat_thread
AFTER INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.touch_chat_thread();


-- 4. Helper RPC: get or create thread for a given pair (caller must be one of the two)
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

  -- Verify the pair has any real relationship (lesson or rate)
  IF NOT EXISTS (SELECT 1 FROM public.lessons WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_rates WHERE tutor_id = _tutor_id AND student_id = _student_id) THEN
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


-- 5. Realtime
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_threads REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_threads;