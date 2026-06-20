-- ============================================================================
-- error_log — client-side runtime errors, surfaced to managers on /errors.
-- Lets the site admin (manager) see what other users hit, to react fast.
-- ⚠️ Apply via Supabase/Lovable (a repo migration is not live until applied).
--    Timestamp is above the latest applied; bump if Lovable applied anything newer.
-- ============================================================================

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

-- Any authenticated user can record their own error (or an anonymous one).
DROP POLICY IF EXISTS "error_log insert own" ON public.error_log;
CREATE POLICY "error_log insert own" ON public.error_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Only managers (site admins) can read the log.
DROP POLICY IF EXISTS "error_log manager read" ON public.error_log;
CREATE POLICY "error_log manager read" ON public.error_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- Managers can clear entries.
DROP POLICY IF EXISTS "error_log manager delete" ON public.error_log;
CREATE POLICY "error_log manager delete" ON public.error_log
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

GRANT INSERT, SELECT, DELETE ON public.error_log TO authenticated;
