ALTER TABLE public.chat_messages 
ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chat_messages_archived 
ON public.chat_messages(thread_id, archived, created_at DESC);