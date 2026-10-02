/**
 * Записи використання продукту (02.10): два події, які потрібні для DAU/WAU/MAU
 * і воронки — `app_open` (раз на сесію: роль, платформа) і `page_view` (раз на
 * шлях за 5 хвилин). Без тексту, без чужих даних: лише шлях і роль. Усе інше
 * (учень доданий, урок створений, імпорт) уже пишуть самі екрани через logEvent.
 */
import { logEvent } from "@/lib/analytics";

const OPEN_KEY = "otutorhub.app_open";
const seen = new Map<string, number>();
const PAGE_VIEW_TTL_MS = 5 * 60_000;

export function logAppOpen(role: string | null, platform: "web" | "ios" | "android" | "unknown"): void {
  try {
    if (sessionStorage.getItem(OPEN_KEY)) return;
    sessionStorage.setItem(OPEN_KEY, "1");
  } catch { /* приватний режим — лічимо щоразу, не страшно */ }
  logEvent("app_open", { role: role ?? "unknown", platform });
}

/** Шлях без ідентифікаторів: /schedule?lesson=… → /schedule; /chats/abc → /chats/#. */
export function normalizePath(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\/\d+(?=\/|$)/g, "/#")
    .slice(0, 80);
}

export function logPageView(pathname: string, role: string | null): void {
  const path = normalizePath(pathname);
  const now = Date.now();
  const last = seen.get(path) ?? 0;
  if (now - last < PAGE_VIEW_TTL_MS) return;
  seen.set(path, now);
  logEvent("page_view", { path, role: role ?? "unknown" });
}
