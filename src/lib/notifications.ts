import { supabase } from "@/integrations/supabase/client";

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
  const { error } = await supabase.rpc("create_notification", {
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

interface NotifyManagers {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

// Fan a notification out to every manager. A non-manager (e.g. a student filing a
// tutor request) cannot read user_roles to find managers under RLS, so this goes
// through the notify_managers SECURITY DEFINER RPC (migration
// 20260618130000_notify_managers_rpc.sql). The caller passes a pre-localized
// title/body so i18n stays client-side. Best-effort: if the RPC isn't applied yet
// it errors harmlessly and managers still see the request via the dashboard task.
export async function notifyManagers({ type, title, body, link }: NotifyManagers) {
  const { error } = await supabase.rpc("notify_managers", {
    _type: type,
    _title: title,
    _body: body ?? null,
    _link: link ?? null,
  });
  if (error) {
    console.error("[notifications] notify_managers failed:", error);
  }
}

/**
 * 26.10: тип сповіщення про заявку несе id самої заявки — `tutor_request_<id>`,
 * `pro_request_<id>`. Раніше тип був сталим, а `create_notification` дедуплікує за
 * (user, type) на 24 год, тож ДРУГА заявка за добу ковталась мовчки. Той самий тип
 * ставить тригер у базі (міграція 20261026120000) — клієнтський виклик лишається
 * запасним і дедуплікується з ним. Id народжується тут, щоб і рядок заявки, і тип
 * сповіщення несли один ключ без зайвого читання після вставки.
 */
export function newRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* старі WebView без randomUUID */ }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export const requestNotificationType = (kind: "tutor_request" | "pro_request", id: string) => `${kind}_${id}`;
