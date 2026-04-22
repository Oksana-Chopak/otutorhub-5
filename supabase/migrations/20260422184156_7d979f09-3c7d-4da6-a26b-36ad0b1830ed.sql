-- Track per-user "last read" timestamp for each chat thread
CREATE TABLE IF NOT EXISTS public.chat_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_reads_user_idx ON public.chat_reads (user_id);
CREATE INDEX IF NOT EXISTS chat_reads_thread_idx ON public.chat_reads (thread_id);

ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;

-- Each user manages only their own read state
CREATE POLICY "Users view own read marks"
  ON public.chat_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own read marks"
  ON public.chat_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own read marks"
  ON public.chat_reads FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own read marks"
  ON public.chat_reads FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Auto-update updated_at
CREATE TRIGGER chat_reads_updated_at
  BEFORE UPDATE ON public.chat_reads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
