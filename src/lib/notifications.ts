import { supabase } from "@/integrations/supabase/client";

// Use any-cast since the notifications table is new and not yet in generated types.
// Types will be regenerated automatically by Lovable after migration is applied.
const db = supabase as unknown as typeof supabase & {
  from(table: "notifications"): ReturnType<typeof supabase.from>;
};

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

  if (error) return; // don't push if insert failed

  // Fire-and-forget push notification (no await — never blocks UI)
  supabase.functions.invoke("send-push", {
    body: { userId, title, body: body ?? "", link: link ?? "/" },
  }).catch(() => { /* push is best-effort */ });
}
