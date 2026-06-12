// Server-side helper: fan out a Web Push via the send-push edge function.
// Never throws; returns true only if at least one push was actually delivered
// (i.e. the user has active push subscriptions and an endpoint accepted it).
export interface WebPushPayload {
  userId: string;
  title: string;
  body?: string;
  link?: string;
  /** Notification tag — pushes with the same tag replace each other on the device. */
  tag?: string;
}

export async function sendWebPush(
  supabaseUrl: string,
  serviceKey: string,
  payload: WebPushPayload,
): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({ sent: 0 }));
    return ((data as { sent?: number })?.sent ?? 0) > 0;
  } catch {
    return false;
  }
}
