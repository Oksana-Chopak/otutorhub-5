/**
 * Воронка лендінгу до реєстрації.
 *
 * ПРОБЛЕМА: `app_events` пише лише авторизований (`user_id = auth.uid()`,
 * grant тільки для `authenticated`). Анонімний відвідувач лендінгу не може
 * записати жодної події — logEvent просто мовчки ковтне помилку.
 *
 * РІШЕННЯ ТУТ: складаємо події в localStorage і зливаємо їх ПІСЛЯ входу, коли
 * user_id уже є. Так уся дорога «вставив список → побачив цифри → зареєструвався»
 * привʼязується до акаунта і видно, де саме люди відвалюються.
 *
 * ЧОГО ЦЕ НЕ ЗАКРИВАЄ (свідомо, і про це сказано власниці): того, хто подивився
 * і ПІШОВ, тут не буде — його подій нікуди зливати. Щоб бачити і таких, потрібен
 * або Pixel/CAPI, або анонімний ендпоінт; і те, й те — окреме рішення, не
 * побічний ефект калькулятора.
 */
const KEY = "tutorhub.landingFunnel";
const MAX = 40;

export interface FunnelEvent { name: string; props: Record<string, unknown>; at: string }

export function landingEvent(name: string, props: Record<string, unknown> = {}): void {
  try {
    const buf: FunnelEvent[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    // Дедуп однакових кроків: цифри перераховуються на кожен символ, а подія
    // «побачив числа» цікава один раз за сесію, не сто разів.
    if (buf.some((e) => e.name === name)) return;
    buf.push({ name, props, at: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(buf.slice(-MAX)));
  } catch { /* приватний режим — воронка не важливіша за роботу сторінки */ }
}

export function takeLandingFunnel(): FunnelEvent[] {
  try {
    const buf: FunnelEvent[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.removeItem(KEY);
    return Array.isArray(buf) ? buf : [];
  } catch { return []; }
}

/** Розпізнаний список — щоб після реєстрації не просити вводити його вдруге. */
const DRAFT = "tutorhub.landingDraft";

export function saveLandingDraft(text: string): void {
  try { if (text.trim()) localStorage.setItem(DRAFT, text); } catch { /* ignore */ }
}
export function takeLandingDraft(): string | null {
  try { const v = localStorage.getItem(DRAFT); if (v) localStorage.removeItem(DRAFT); return v; } catch { return null; }
}
export function peekLandingDraft(): string | null {
  try { return localStorage.getItem(DRAFT); } catch { return null; }
}
