CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  google_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_owns_token_select" ON public.google_calendar_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user_owns_token_insert" ON public.google_calendar_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_owns_token_update" ON public.google_calendar_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_owns_token_delete" ON public.google_calendar_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER update_google_calendar_tokens_updated_at
  BEFORE UPDATE ON public.google_calendar_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add column on lessons to track synced Google event id (best-effort, idempotent sync)
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS google_event_id text;