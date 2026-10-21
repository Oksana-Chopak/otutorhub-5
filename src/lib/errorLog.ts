import { supabase } from "@/integrations/supabase/client";

// Best-effort client error logger → public.error_log (superadmin reads it on /errors).
// Deduped within a short window so a render loop can't spam the table, and never
// throws (logging must not break the app).
//
// Red team 20.10: запис іде через RPC `log_client_error` (міграція 20261020100000),
// не прямим INSERT: user_id бере сервер із JWT, стеля 60/год на людину чи адресу,
// адреса без query і без токенів у шляху. До вставки SQL виклик тихо падає — як і
// раніше падав би insert без таблиці.

const recent = new Map<string, number>();
const DEDUPE_MS = 30_000;

/** Адреса для журналу: без query (?invite=, ?email=, ?confirmed=) і без токенів у шляху. */
export function scrubUrlForLog(pathname: string): string {
  const path = pathname.split("?")[0].split("#")[0];
  return path.replace(/^(\/(pay|join)\/)[^/]+/, "$1…").slice(0, 300);
}

export async function logError(
  message: string,
  stack?: string | null,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!message) return;
    // Шум сторонніх браузерних розширень (MetaMask тощо) — не наші баги, не логуємо.
    const noise = ["MetaMask", "chrome-extension://", "moz-extension://", "safari-extension://"];
    const hay = `${message} ${stack ?? ""}`;
    if (noise.some((n) => hay.includes(n))) return;
    // 19.10, /finances: «Lock "lock:sb-…-auth-token" was released because another
    // request stole it» — це supabase-js ділить замок сесії між двома вкладками
    // (або вкладкою й нативною обгорткою). Сесія лишається цілою, запит
    // повторюється сам; у /errors це читалось як збій платежів. Не наш баг.
    if (/Lock "lock:sb-[^"]*" was released because another request stole it|NavigatorLockAcquireTimeoutError|Acquiring an exclusive Navigator LockManager lock/.test(hay)) return;
    const key = `${message}::${(stack ?? "").slice(0, 200)}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(key, now);

    // RPC з міграції 20261020100000 — до перегенерації types.ts через (rpc as any),
    // як і решта свіжих RPC у репо.
    await (supabase.rpc as any)("log_client_error", {
      _message: String(message).slice(0, 2000),
      _stack: stack ? String(stack).slice(0, 6000) : null,
      _url: typeof window !== "undefined" ? scrubUrlForLog(window.location.pathname) : null,
      _user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : null,
      _context: context ?? null,
    });
  } catch {
    // Never let logging throw.
  }
}

let installed = false;
/** Capture uncaught errors + unhandled promise rejections globally. Call once. */
export function installGlobalErrorLogging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    void logError(e.message || "window.onerror", (e as any).error?.stack ?? null, {
      type: "error",
      filename: (e as any).filename ?? null,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason: any = (e as PromiseRejectionEvent).reason;
    void logError(
      reason?.message ? String(reason.message) : "unhandledrejection",
      reason?.stack ?? null,
      { type: "unhandledrejection" },
    );
  });
}
