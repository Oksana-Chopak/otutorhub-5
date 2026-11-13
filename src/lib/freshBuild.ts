/**
 * Стара вкладка = старі помилки (13.11, скарга власниці).
 *
 * Застосунок — одна сторінка: вкладка, відкрита тиждень тому, виконує код тижневої
 * давності, скільки б разів після цього не публікували. Власниця у такій вкладці
 * побачила час у форматі AM/PM і «row-level security» при створенні уроку — обидві
 * помилки виправлені ще 06.11, але її вкладка про це не знала.
 *
 * Тепер вкладка сама звіряє свій штамп збірки з `/version.json` на сервері (при
 * поверненні на вкладку, при переході між екранами, не частіше ніж раз на 5 хв) і,
 * якщо опубліковано новішу збірку, перезавантажується — лише в безпечний момент:
 * коли немає відкритої форми й людина нічого не вводить.
 */
import { BUILD_STAMP } from "@/lib/buildInfo";
import { isNativeApp } from "@/lib/platform";

const CHECK_EVERY_MS = 5 * 60 * 1000;
const TRIED_KEY = "oth.freshBuild.tried";

let lastCheck = 0;
let staleStamp: string | null = null;

/** Чиста частина для тестів: чи відрізняється серверний штамп від нашого. */
export function isNewerBuild(own: string, remote: unknown): remote is string {
  return typeof remote === "string" && remote.length >= 6 && own !== "dev" && remote !== own;
}

async function fetchRemoteStamp(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { stamp?: unknown };
    return typeof j.stamp === "string" ? j.stamp : null;
  } catch {
    return null; // без мережі — не привід щось робити
  }
}

function busy(): boolean {
  if (typeof document === "undefined") return true;
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [data-state="open"][data-vaul-drawer]')) return true;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return true;
  // недописаний текст у будь-якому полі на екрані — не губимо
  for (const el of Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"))) {
    if (el.value.trim().length > 0) return true;
  }
  return false;
}

function reloadOnce(stamp: string) {
  try {
    // якщо після перезавантаження сервер усе ще віддає стару збірку (кеш CDN),
    // вдруге на той самий штамп не перезавантажуємось — без петлі
    if (sessionStorage.getItem(TRIED_KEY) === stamp) return;
    sessionStorage.setItem(TRIED_KEY, stamp);
  } catch { /* приватне вікно: один раз перезавантажимось і так */ }
  window.location.reload();
}

/** Викликати при переході між екранами і при поверненні на вкладку. */
export async function ensureFreshBuild(): Promise<void> {
  if (BUILD_STAMP === "dev" || isNativeApp() || typeof window === "undefined") return;
  if (!staleStamp && Date.now() - lastCheck >= CHECK_EVERY_MS) {
    lastCheck = Date.now();
    const remote = await fetchRemoteStamp();
    if (isNewerBuild(BUILD_STAMP, remote)) staleStamp = remote;
  }
  if (staleStamp && !busy()) reloadOnce(staleStamp);
}
