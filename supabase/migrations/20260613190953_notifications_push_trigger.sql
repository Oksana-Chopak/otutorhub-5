-- Web-push for in-app notifications.
--
-- Problem: client code (src/lib/notifications.ts) called the send-push edge
-- function with a browser JWT, but send-push requires the service-role key, so
-- every client-side push got a 403.
--
-- Fix: fire the push server-side from a SECURITY DEFINER trigger on
-- public.notifications. AFTER INSERT, we POST to send-push with the service-role
-- bearer via pg_net (async, never blocks the insert). The client invoke is being
-- removed in the same change so push is sent exactly once.

CREATE OR REPLACE FUNCTION public.send_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Async edge call (pg_net) — do not block the INSERT.
  PERFORM net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body    := jsonb_build_object(
      'userId', NEW.user_id::text,
      'title',  NEW.title,
      'body',   COALESCE(NEW.body, ''),
      'link',   COALESCE(NEW.link, '/'),
      'tag',    NEW.type
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the notification insert because of a push failure.
  RAISE WARNING 'send_push_on_notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Trigger: AFTER INSERT, one row at a time
DROP TRIGGER IF EXISTS trg_send_push_on_notification ON public.notifications;
CREATE TRIGGER trg_send_push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.send_push_on_notification();

-- Only the trigger should call this — never clients directly.
REVOKE EXECUTE ON FUNCTION public.send_push_on_notification() FROM anon, authenticated, public;
