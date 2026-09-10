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
/** Старий віджет «Спробуй прямо зараз» (учень / зустріч / оплата). */
const DEMO = "tutorhub.demo";
/** Ключ у user_metadata акаунта — список їде РАЗОМ із реєстрацією. */
export const LANDING_DRAFT_META = "landing_draft";
const LANDING_DRAFT_DONE_META = "landing_draft_done";
/** Стеля для метаданих auth: 40 учнів із контактами — це ~4 КБ, беремо з запасом. */
export const LANDING_DRAFT_MAX = 12_000;
/** «Уже показували в цій сесії» — щоб онбординг не відкривав імпорт на кожен рендер. */
const SHOWN = "tutorhub.handoffShown";

export function saveLandingDraft(text: string): void {
  try { if (text.trim()) localStorage.setItem(DRAFT, text); } catch { /* ignore */ }
}
export function takeLandingDraft(): string | null {
  try { const v = localStorage.getItem(DRAFT); if (v) localStorage.removeItem(DRAFT); return v; } catch { return null; }
}
export function peekLandingDraft(): string | null {
  try { return localStorage.getItem(DRAFT); } catch { return null; }
}

/* ── Естафета «лендінг → застосунок» (10.09) ─────────────────────────────────
   Обіцянка на лендінгу: «створиш акаунт — і цей список уже буде всередині».
   До 10.09 вона трималась на localStorage і виконувалась лише на /my-students,
   куди новий репетитор не потрапляє (його зустрічає /onboarding), а віджет
   «Спробуй прямо зараз» писав tutorhub.demo, якого ніхто ніколи не читав.
   Гірше: лист підтвердження часто відкривають з іншого пристрою чи в іншому
   браузері — localStorage там порожній, і список губився назавжди.

   Тепер список має ТРИ джерела в порядку довіри:
     1. tutorhub.landingDraft — калькулятор (той самий браузер);
     2. tutorhub.demo — старий віджет, перекладений в один рядок для парсера;
     3. user_metadata.landing_draft — копія, що поїхала з реєстрацією
        (AuthPage кладе її в options.data), тож працює на БУДЬ-ЯКОМУ пристрої.
   Споживається ПІСЛЯ успішного імпорту (consumeLandingHandoff), а не при
   відкритті: закрив вікно випадково — список не зник. */

export interface DemoPayload {
  student?: { name: string; subject?: string | null; price?: number | null } | null;
  lesson?: { studentName: string; date: string; time: string } | null;
  payment?: { studentName: string; amount?: number | null; lessons?: number | null } | null;
}

const DAY_ABBR = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];

/** Дані віджета «Спробуй прямо зараз» → один рядок у форматі імпорту. */
export function demoToDraftLine(p: DemoPayload | null | undefined): string | null {
  if (!p) return null;
  const name = (p.student?.name || p.lesson?.studentName || p.payment?.studentName || "").trim();
  if (!name) return null;
  const parts: string[] = [name];
  const subject = p.student?.subject?.trim();
  if (subject) parts.push(subject);
  if (p.student?.price && p.student.price > 0) parts.push(String(p.student.price));
  if (p.lesson?.date && p.lesson?.time) {
    const d = new Date(`${p.lesson.date}T${p.lesson.time}:00`);
    if (!Number.isNaN(d.getTime())) parts.push(`${DAY_ABBR[d.getDay()]} ${p.lesson.time}`);
  }
  if (p.payment) {
    // Ключове слово й одиниці — англійські синоніми парсера (prepay / lessons /
    // uah): рядок читається однаково, а в коді немає літералів мови й валюти.
    if (p.payment.lessons && p.payment.lessons > 0) parts.push(`prepay ${p.payment.lessons} lessons`);
    else if (p.payment.amount && p.payment.amount > 0) parts.push(`prepay ${p.payment.amount} uah`);
  }
  return parts.join(" — ");
}

function readDemo(): string | null {
  try {
    const raw = localStorage.getItem(DEMO);
    if (!raw) return null;
    return demoToDraftLine(JSON.parse(raw) as DemoPayload);
  } catch { return null; }
}

type MetaUser = { user_metadata?: Record<string, unknown> | null } | null | undefined;

function readAccount(user: MetaUser): string | null {
  const m = user?.user_metadata;
  if (!m || m[LANDING_DRAFT_DONE_META] === true) return null;
  const v = m[LANDING_DRAFT_META];
  return typeof v === "string" && v.trim() ? v : null;
}

export type LandingHandoff = { text: string; source: "draft" | "demo" | "account" };

/** Що лежить у естафеті (нічого не стирає). */
export function peekLandingHandoff(user?: MetaUser): LandingHandoff | null {
  const draft = peekLandingDraft();
  if (draft?.trim()) return { text: draft, source: "draft" };
  const demo = readDemo();
  if (demo) return { text: demo, source: "demo" };
  const acc = readAccount(user);
  if (acc) return { text: acc, source: "account" };
  return null;
}

/** Текст для options.data при реєстрації — щоб список пережив зміну пристрою. */
export function landingDraftForSignup(): string | null {
  const h = peekLandingHandoff();
  if (!h) return null;
  return h.text.length > LANDING_DRAFT_MAX ? h.text.slice(0, LANDING_DRAFT_MAX) : h.text;
}

/** Показувати імпорт з естафети раз на сесію браузера (закрив — не нав'язуємось). */
export function claimHandoffShown(): boolean {
  try {
    if (sessionStorage.getItem(SHOWN) === "1") return false;
    sessionStorage.setItem(SHOWN, "1");
    return true;
  } catch { return true; }
}

/** Список перенесено — прибрати з усіх трьох джерел (метадані — best-effort). */
export function consumeLandingHandoff(user?: MetaUser): void {
  try { localStorage.removeItem(DRAFT); } catch { /* ignore */ }
  try { localStorage.removeItem(DEMO); } catch { /* ignore */ }
  if (readAccount(user)) {
    try {
      void supabase.auth
        .updateUser({ data: { [LANDING_DRAFT_META]: null, [LANDING_DRAFT_DONE_META]: true } })
        .then(() => {}, () => {});
    } catch { /* ignore */ }
  }
}
