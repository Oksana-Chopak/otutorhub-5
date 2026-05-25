-- In-app notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id, read, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notifications"
  ON notifications FOR ALL
  USING (auth.uid() = user_id);

-- Cron schedule (requires pg_cron + pg_net extensions, enabled by default in Supabase):
-- Morning check (9:00 Kyiv ≈ 07:00 UTC in summer):
--   SELECT cron.schedule('notifications-morning', '0 7 * * *',
--     $$SELECT net.http_post(url := '<SUPABASE_URL>/functions/v1/scheduled-notifications',
--       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}',
--       body := '{"window":"morning"}'::jsonb)$$);
-- Evening check (19:00 Kyiv ≈ 16:00 UTC in summer):
--   SELECT cron.schedule('notifications-evening', '0 16 * * *',
--     $$SELECT net.http_post(url := '<SUPABASE_URL>/functions/v1/scheduled-notifications',
--       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}',
--       body := '{"window":"evening"}'::jsonb)$$);
-- Replace <SUPABASE_URL> and <SERVICE_ROLE_KEY> and run in Supabase SQL editor.
