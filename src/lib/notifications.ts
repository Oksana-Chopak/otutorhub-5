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
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Deduplication: skip if same user + type was notified within 24h
  const { data: existing } = await db
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("created_at", since)
    .maybeSingle();

  if (existing) return;

  const { error } = await db.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body: body ?? null,
    link: link ?? null,
  });

  if (error) return; // don't notify if insert failed

  // Push is sent server-side by the AFTER INSERT trigger on public.notifications
  // (send_push_on_notification → send-push with the service-role key). We must NOT
  // also invoke send-push from the client — it would 403 (needs service-role) and
  // would double-send. See migration *_notifications_push_trigger.sql.
}
