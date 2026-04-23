
-- Extend tutor_referral_requests with scheduling preferences
ALTER TABLE public.tutor_referral_requests
  ADD COLUMN IF NOT EXISTS preferred_days text,
  ADD COLUMN IF NOT EXISTS preferred_times text;

-- Chat attachments support
CREATE TABLE IF NOT EXISTS public.chat_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,
  uploader_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attach_message ON public.chat_message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_attach_thread ON public.chat_message_attachments(thread_id);

ALTER TABLE public.chat_message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager views all chat attachments"
  ON public.chat_message_attachments FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Participants view chat attachments"
  ON public.chat_message_attachments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chat_threads t
    WHERE t.id = chat_message_attachments.thread_id
      AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
  ));

CREATE POLICY "Participants insert chat attachments"
  ON public.chat_message_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND (
      has_role(auth.uid(), 'manager'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.chat_threads t
        WHERE t.id = chat_message_attachments.thread_id
          AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
      )
    )
  );

CREATE POLICY "Uploader deletes own chat attachment"
  ON public.chat_message_attachments FOR DELETE TO authenticated
  USING (uploader_id = auth.uid() OR has_role(auth.uid(), 'manager'::app_role));

-- Storage bucket for chat attachments (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: any authenticated participant of any thread can read; uploader can write
CREATE POLICY "Chat attachments: participants read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      has_role(auth.uid(), 'manager'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.chat_message_attachments a
        JOIN public.chat_threads t ON t.id = a.thread_id
        WHERE a.storage_path = name
          AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
      )
    )
  );

CREATE POLICY "Chat attachments: authenticated upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Chat attachments: uploader delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR has_role(auth.uid(), 'manager'::app_role))
  );
