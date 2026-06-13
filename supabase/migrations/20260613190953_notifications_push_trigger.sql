-- Web-push for in-app notifications — SUPERSEDED.
--
-- This migration originally added the public.notifications push trigger
-- (send_push_on_notification → send-push edge function). A later migration
-- (20260613204940_...) authored via Lovable now defines the FULL setup: the
-- notifications table + indexes + RLS policies + the identical push trigger.
--
-- To avoid two migrations defining the same function/trigger, the trigger
-- definition has been removed from here and lives authoritatively in 204940.
-- We keep only an idempotent table guard so that, whichever order the two
-- notifications migrations run in, the table exists (the push trigger in 204940
-- attaches to public.notifications).
--
-- The client-side send-push invoke removal (src/lib/notifications.ts) stays in
-- the same change set as before — push is sent exactly once, server-side.

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
