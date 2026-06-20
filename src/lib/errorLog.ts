import { supabase } from "@/integrations/supabase/client";

// Best-effort client error logger → public.error_log (managers read it on /errors).
// Deduped within a short window so a render loop can't spam the table, and never
// throws (logging must not break the app). The table is added by migration
// 20260627000000; until that is applied the insert just fails silently.

const recent = new Map<string, number>();
const DEDUPE_MS = 30_000;

export async function logError(
  message: string,
  stack?: string | null,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!message) return;
    const key = `${message}::${(stack ?? "").slice(0, 200)}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(key, now);

    const { data: auth } = await supabase.auth.getUser();
    await (supabase as any).from("error_log").insert({
      user_id: auth?.user?.id ?? null,
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 6000) : null,
      url:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : null,
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : null,
      context: context ?? null,
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
