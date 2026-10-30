// Сповіщення власниці/менеджерам у Telegram (26.10).
//
// Тригери бази (міграція 20261026120000_owner_alerts) створюють сповіщення з
// типами `tutor_request_<id>` · `pro_request_<id>` · `feedback_new_<id>`; кожне
// сповіщення і так їде в `send-push` (trg_send_push_on_notification). Тут —
// дзеркало саме цих типів у Telegram тому, у кого він привʼязаний
// (`user_telegram_links`). Інші типи (уроки, оплати, бейджі) мають власні
// канали й сюди не потрапляють.
// deno-lint-ignore-file no-explicit-any

export const OWNER_ALERT_PREFIXES = ["tutor_request", "pro_request", "feedback_new"] as const;

// Лише типи, які ставить ТРИГЕР бази (з id заявки). Голий `tutor_request` зі
// старої збірки клієнта чи `tutor_request_cancelled` сюди не входять — у них
// свої канали (дзвіночок + push), і один запит не має дзвонити двічі.
const OWNER_ALERT_RE = new RegExp(
  `^(${OWNER_ALERT_PREFIXES.join("|")})_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  "i",
);

export function isOwnerAlertType(tag: unknown): boolean {
  return typeof tag === "string" && OWNER_ALERT_RE.test(tag);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Лише відносний шлях усередині застосунку; будь-що інше → головна. */
export function safeAppPath(link: unknown): string {
  if (typeof link !== "string" || !link.startsWith("/") || link.startsWith("//")) return "/";
  return link.slice(0, 300);
}

export function ownerAlertTelegramText(
  msg: { title: string; body?: string; link?: string },
  appBase = "https://otutorhub.com",
): string {
  const lines = [`<b>${escapeHtml((msg.title ?? "").slice(0, 200))}</b>`];
  const body = (msg.body ?? "").trim();
  if (body) lines.push(escapeHtml(body.slice(0, 600)));
  lines.push("", `<a href="${appBase}${safeAppPath(msg.link)}">Відкрити →</a>`);
  return lines.join("\n");
}

export type OwnerAlertResult = "sent" | "skipped:not_owner_alert" | "skipped:no_token" | "skipped:no_telegram" | `failed:${string}`;

/**
 * Дзеркало одного сповіщення в Telegram. Best-effort: жодних винятків назовні —
 * push уже пішов, і відповідь send-push не має залежати від Telegram.
 */
export async function mirrorOwnerAlertToTelegram(
  db: any,
  botToken: string | undefined,
  msg: { userId: string; title: string; body?: string; link?: string; tag?: unknown },
): Promise<OwnerAlertResult> {
  try {
    if (!isOwnerAlertType(msg.tag)) return "skipped:not_owner_alert";
    if (!botToken) return "skipped:no_token";
    const { data: link, error } = await db
      .from("user_telegram_links")
      .select("chat_id")
      .eq("user_id", msg.userId)
      .not("chat_id", "is", null)
      .maybeSingle();
    if (error) return `failed:link:${String(error.message).slice(0, 80)}`;
    if (!link?.chat_id) return "skipped:no_telegram";
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: link.chat_id,
        text: ownerAlertTelegramText(msg),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("owner alert → Telegram failed", res.status, txt.slice(0, 200));
      return `failed:${res.status}`;
    }
    return "sent";
  } catch (e) {
    console.error("owner alert → Telegram threw", e);
    return `failed:${String((e as Error)?.message ?? e).slice(0, 80)}`;
  }
}
