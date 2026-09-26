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
  /**
   * ВАЖІЛЬ 3в (аудит шляхів 24.09): кнопки в САМОМУ сповіщенні. Найкоротший
   * шлях у продукті — той, де застосунок майже не треба відкривати.
   *
   * Свідома межа: кнопка НЕ пише в базу з service worker. Там немає сесії
   * людини, тож «позначити оплату» звідти вимагало б підписаного одноразового
   * токена — нова поверхня для атаки на гроші. Замість цього кнопка веде
   * ГЛИБОКИМ посиланням із уже наведеною дією: застосунок відкривається рівно
   * там, де лишився один дотик (і той — під сесією людини).
   *
   * Лише відносні шляхи (`/…`): sw.js однаково відкидає чужий origin.
   */
  actions?: Array<{ action: string; title: string; link: string }>;
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
