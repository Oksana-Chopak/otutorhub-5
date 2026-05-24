
CREATE TABLE public.chat_message_reactions (
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_chat_message_reactions_message ON public.chat_message_reactions(message_id);

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views all reactions"
ON public.chat_message_reactions FOR SELECT
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Participants view reactions"
ON public.chat_message_reactions FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.chat_messages m
  JOIN public.chat_threads t ON t.id = m.thread_id
  WHERE m.id = chat_message_reactions.message_id
    AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
));

CREATE POLICY "Users add own reactions"
ON public.chat_message_reactions FOR INSERT
WITH CHECK (
  auth.uid() = user_id AND (
    has_role(auth.uid(), 'manager'::app_role) OR
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      JOIN public.chat_threads t ON t.id = m.thread_id
      WHERE m.id = chat_message_reactions.message_id
        AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
    )
  )
);

CREATE POLICY "Users remove own reactions"
ON public.chat_message_reactions FOR DELETE
USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reactions;
ALTER TABLE public.chat_message_reactions REPLICA IDENTITY FULL;
