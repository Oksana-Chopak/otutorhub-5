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
 * ТОГО, ХТО ПІШОВ (10.09): його подій нікуди зливати, тож паралельно кожен крок
 * іде в анонімний лічильник `log_landing_event` — БЕЗ user_id, IP і пристрою,
 * лише «сьогодні N разів дійшли до кроку X» (міграція 20260910100000). Дедуп
 * тут у памʼяті модуля, тому лічильник рахує ЗАХОДИ на сторінку, а не натиски.
 * localStorage у цьому шляху не бере участі — анонімний відвідувач лишається
 * анонімним навіть для нашої власної бази.
 */
import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "@/lib/analytics";
import { metaTrack } from "@/lib/metaPixel";

const KEY = "tutorhub.landingFunnel";
const MAX = 40;

/** Один крок — одна відмітка за завантаження сторінки (памʼять, не сховище). */
const counted = new Set<string>();

function countAnon(name: string, props: Record<string, unknown>): void {
  if (counted.has(name)) return;
  counted.add(name);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  try {
    void (supabase as any)
      .rpc("log_landing_event", {
        _name: name,
        _students: n(props.students),
        _owed: n(props.owed),
        _monthly: n(props.monthly),
      })
      .then(() => {}, () => {});
  } catch { /* поки міграції немає — тихо; сторінка важливіша за лічильник */ }
}

export interface FunnelEvent { name: string; props: Record<string, unknown>; at: string }

export function landingEvent(name: string, props: Record<string, unknown> = {}): void {
  countAnon(name, props);
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

/**
 * Злити накопичені кроки в `app_events` — уже з user_id, бо людина ввійшла.
 * Так у CRM видно повний шлях «побачив → вставив → зареєструвався», а не
 * тільки хвіст після реєстрації. Разом із цим шлемо в Meta CompleteRegistration
 * (якщо є ключі й згода) — це та сама подія, під яку оптимізується реклама.
 */
export function flushLandingFunnel(): void {
  const buf = takeLandingFunnel();
  if (buf.length === 0) return;
  for (const e of buf) {
    logEvent(e.name, { ...e.props, at: e.at, from: "landing" });
  }
  metaTrack("CompleteRegistration", {
    students: Number(buf.find((e) => e.name === "landing_rows_parsed")?.props?.students) || 0,
  });
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
