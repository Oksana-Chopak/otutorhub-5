CREATE TABLE IF NOT EXISTS public.error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  role text,
  message text NOT NULL,
  stack text,
  url text,
  user_agent text,
  context jsonb
);

CREATE INDEX IF NOT EXISTS idx_error_log_created_at ON public.error_log (created_at DESC);

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "error_log insert own" ON public.error_log;
CREATE POLICY "error_log insert own" ON public.error_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "error_log manager read" ON public.error_log;
CREATE POLICY "error_log manager read" ON public.error_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS "error_log manager delete" ON public.error_log;
CREATE POLICY "error_log manager delete" ON public.error_log
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

GRANT INSERT, SELECT, DELETE ON public.error_log TO authenticated;
GRANT ALL ON public.error_log TO service_role;