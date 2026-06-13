import { supabase } from "@/integrations/supabase/client";

// Use any-cast since the notifications table is new and not yet in generated types.
// Types will be regenerated automatically by Lovable after migration is applied.
const db = supabase as any;

interface InsertNotification {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

export async function insertNotification({ userId, type, title, body, link }: InsertNotification) {
  // Cross-user notifications (e.g. tutor → student) are blocked by the
  // "insert own" RLS on public.notifications. We go through the
  // create_notification SECURITY DEFINER RPC instead, which also does the 24h
  // dedup server-side. The AFTER INSERT trigger then fires the web-push.
  const { error } = await db.rpc("create_notification", {
    _user_id: userId,
    _type: type,
    _title: title,
    _body: body ?? null,
    _link: link ?? null,
  });

  if (error) {
    // Best-effort: never block the user's action because a notification failed.
    console.error("[notifications] create_notification failed:", error);
  }

  // Push is sent server-side by the AFTER INSERT trigger on public.notifications
  // (send_push_on_notification → send-push with the service-role key). We must NOT
  // also invoke send-push from the client — it would 403 (needs service-role) and
  // would double-send. See migration *_notifications_push_trigger.sql.
}
