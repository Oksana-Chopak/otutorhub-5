/**
 * Імпорт «усе, що є» текстом (05.09 — учні; 07.09 — борги, передоплати,
 * розклад, контакти; рішення власниці: «мінімум клацань, в 1–2 кроки»).
 *
 * Парсер СВІДОМО детермінований, без AI: миттєво, офлайн, приватно (список
 * дітей з телефонами не літає в жодну модель), а помилки видно в превʼю до
 * створення. Фото зошита з AI-розбором — окремий етап (v2).
 *
 * Рядок = імʼя + будь-які хвости в будь-якому порядку (роздільники: — – - , ; | таб):
 *   «Марія Коваль — англійська — 600 — борг 1200 — пн 18:00»
 *   «Іван; математика; 500; передоплата 3»
 *   «Оля — 350 — вт,чт 16:30 — +380671234567 — mama@gmail.com»
 *   «Петро - фізика»                → без ціни
 *   «Соломія»                       → лише імʼя
 *   «Марк Іваненко 600»             → без роздільників: хвостове число = ціна
 * Хвости впізнаються за словом: «борг 1200» / «борг 2 уроки», «передоплата 3»
 * (уроки) / «передоплата 1500 ₴» (гроші), день тижня + час, «90 хв», телефон,
 * пошта, @telegram. Усе нерозпізнане — у нотатку.
 *
 * Таблиця з Excel / Google Таблиць (табуляція + рядок заголовків) розбирається
 * по заголовках: імʼя, предмет, ціна, борг, передоплата, день, час, телефон,
 * пошта, telegram, нотатка — у будь-якому порядку.
 */

/**
 * Валюта імпорту v1 — гривня: імпорт запускається для українського ринку
 * (рішення власниці 05.09), а ставки пари в інших валютах правляться в
 * картці учня. Єдине місце, де це зашито.
 */
export const IMPORT_CURRENCY = "UAH";

export interface ScheduleSlot {
  /** 1 = понеділок … 7 = неділя (ISO). */
  weekday: number;
  /** "HH:MM" */
  time: string;
}

export type ImportWarning =
  | "debt_without_price"     // борг сумою без ставки — ляже однією позицією
  | "debt_lessons_need_price" // «борг 2 уроки» без ставки — не порахувати
  | "prepay_covers_debt"     // передоплата й борг одночасно — зводимо в нетто
  | "schedule_without_price"; // розклад є, ціни нема — уроки без ціни

export interface ParsedStudent {
  /** Оригінальний рядок — показуємо в превʼю при помилці. */
  raw: string;
  firstName: string;
  lastName: string;
  subject: string | null;
  price: number | null;
  /** Борг сумою (₴) — або кількістю уроків (тоді потрібна ставка). */
  debtAmount: number | null;
  debtLessons: number | null;
  /** Передоплата: уроками або сумою. */
  prepayLessons: number | null;
  prepayAmount: number | null;
  schedule: ScheduleSlot[];
  durationMinutes: number | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  note: string | null;
  warnings: ImportWarning[];
  /** Людською мовою, чому рядок не буде імпортовано (null = ок). */
  error: "empty_name" | null;
}

const SEPARATORS = /[—–;|\t]|(?:\s-\s)|,/g;

/**
 * Число з пробілом як роздільником тисяч: «1 200», «1 200,50», «1200».
 * Люди пишуть суми саме так (і Excel так копіює — з нерозривним пробілом).
 * До 10.09 «борг 1 200» не читався як борг і мовчки їхав у нотатку: гроші
 * не губились, але й у суму не потрапляли. Варіант з тисячами стоїть ПЕРШИМ,
 * бо чергування в регексі впорядковане; він вимагає рівно три цифри після
 * пробілу, тому «борг 2 уроки» лишається уроками.
 */
const N = String.raw`\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?`;

const DEBT_RE = new RegExp(
  String.raw`^(?:борг|заборгованість|заборгував(?:ла)?|винен|винна|debt|owes?|skuld)\s*(?:за\s*)?:?\s*(${N})\s*([a-zа-яіїєґ₴€$.]*)$`,
  "i",
);
const PREPAY_RE = new RegExp(
  String.raw`^(?:передоплата|передплата|аванс|наперед|оплачено наперед|prepaid|prepay|prepayment|förskott)\s*:?\s*(${N})\s*([a-zа-яіїєґ₴€$.]*)$`,
  "i",
);
const PRICE_RE = new RegExp(String.raw`^\s*(${N})\s*(?:грн|uah|₴|kr|sek|€|eur)?\s*$`, "i");
const TRAILING_PRICE_RE = new RegExp(
  String.raw`\s+(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{2,6})\s*(?:грн|uah|₴)?\s*$`,
  "i",
);

const HEADER_WORDS = new Set([
  "імя", "ім'я", "имя", "name", "student", "предмет", "subject", "ціна", "цена", "price", "rate",
  "ставка", "учень", "учні", "борг", "debt", "передоплата", "prepaid", "prepay", "аванс", "день", "дні",
  "day", "weekday", "час", "time", "розклад", "schedule", "телефон", "phone", "пошта", "email", "e-mail",
  "telegram", "тг", "нотатка", "коментар", "note", "comment", "прізвище", "surname", "тривалість", "duration",
]);

const LESSON_UNIT = /^(?:ур\.?|урок|уроки|уроків|занят\w*|lessons?|l\.?)$/i;
const MONEY_UNIT = /^(?:грн|uah|₴|kr|sek|€|eur|\$)$/i;

const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(?:що)?(?:пн|пон|понеділок|понеділка|mon|monday|mån|måndag)$/i, 1],
  [/^(?:що)?(?:вт|вів|вівторок|вівторка|tue|tues|tuesday|tis|tisdag)$/i, 2],
  [/^(?:що)?(?:ср|сер|середа|середи|wed|wednesday|ons|onsdag)$/i, 3],
  [/^(?:що)?(?:чт|чет|четвер|четверга|thu|thur|thurs|thursday|tor|tors|torsdag)$/i, 4],
  [/^(?:що)?(?:пт|пʼятниця|п'ятниця|п’ятниця|пятниця|пʼятниці|п'ятниці|fri|friday|fre|fredag)$/i, 5],
  [/^(?:що)?(?:сб|суб|субота|суботи|sat|saturday|lör|lördag)$/i, 6],
  [/^(?:що)?(?:нд|нед|неділя|неділі|sun|sunday|sön|söndag)$/i, 7],
];
const TIME_RE = /^(?:о\s*|at\s*|kl\.?\s*)?([01]?\d|2[0-3])(?:[:.\-h]([0-5]\d))?$/i;
const WEEKDAY_WORD = "(?:що)?(?:пн|пон|понеділок|вт|вів|вівторок|ср|сер|середа|чт|чет|четвер|пт|пʼятниця|п'ятниця|п’ятниця|пятниця|сб|суб|субота|нд|нед|неділя|mon|tue|wed|thu|fri|sat|sun|mån|tis|ons|tor|tors|fre|lör|sön)";
// «вт,чт 16:30» — кома між днями тижня НЕ роздільник полів: склеюємо плюсом до
// розбиття рядка, щоб дні лишились в одному токені.
// (\b не працює з кирилицею в JS — межу слова робимо явно)
const DAY_COMMA_RE = new RegExp(`(${WEEKDAY_WORD})\\s*,\\s*(?=${WEEKDAY_WORD}(?![a-zа-яіїєґ]))`, "gi");

function looksLikeHeader(line: string): boolean {
  // Апострофи бувають різні (' ʼ ’ `) — «Імʼя» в заголовку має ловитись усіма.
  const words = line
    .toLowerCase()
    .replace(/['ʼ’`]/g, "")
    .replace(/[^a-zа-яіїєґ\- ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((w) => HEADER_WORDS.has(w));
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  // Перше слово — імʼя, решта — прізвище (по-батькові теж туди: краще в
  // прізвищі, ніж загублене).
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function num(s: string): number {
  return Number(s.replace(",", ".").replace(/\s+/g, ""));
}

/** «борг 1200» / «борг 2 уроки» / «винен 600 грн» → {amount} | {lessons} */
function parseDebt(tok: string): { amount?: number; lessons?: number } | null {
  const m = DEBT_RE.exec(tok);
  if (!m) return null;
  const n = num(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "").trim();
  if (unit && LESSON_UNIT.test(unit)) return { lessons: Math.round(n) };
  return { amount: n };
}

/** «передоплата 3» (уроки) / «передоплата 1500 ₴» (гроші) / «аванс 2 уроки» */
function parsePrepay(tok: string): { amount?: number; lessons?: number } | null {
  const m = PREPAY_RE.exec(tok);
  if (!m) return null;
  const n = num(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "").trim();
  if (unit && LESSON_UNIT.test(unit)) return { lessons: Math.round(n) };
  if (unit && MONEY_UNIT.test(unit)) return { amount: n };
  // Без одиниці: маленьке число — уроки, велике — гроші.
  return n <= 30 && Number.isInteger(n) ? { lessons: n } : { amount: n };
}

/** «пн 18:00», «вт та чт 16:30», «щопн о 18», «mon 17» → слоти. */
function parseSchedule(tok: string): ScheduleSlot[] | null {
  const words = tok
    .replace(/[,/&+]|\s(?:і|та|and|och)\s/gi, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && !/^(?:о|в|у|at|kl\.?)$/i.test(w));
  const days: number[] = [];
  let time: string | null = null;
  for (const w of words) {
    const wd = WEEKDAYS.find(([re]) => re.test(w));
    if (wd) { days.push(wd[1]); continue; }
    const tm = TIME_RE.exec(w);
    if (tm && days.length > 0 && time === null) {
      time = `${tm[1].padStart(2, "0")}:${tm[2] ?? "00"}`;
      continue;
    }
    return null; // стороннє слово — це не розклад
  }
  if (days.length === 0 || time === null) return null;
  return Array.from(new Set(days)).map((weekday) => ({ weekday, time: time as string }));
}

export function parseStudentLine(rawLine: string): ParsedStudent | null {
  const raw = rawLine.trim();
  if (!raw) return null;
  if (looksLikeHeader(raw)) return null;

  // Нумерація списку («1. Марія», «2) Іван») — зрізаємо; дні тижня через кому — склеюємо.
  const line = raw.replace(/^\s*\d{1,3}\s*[.)]\s*/, "").replace(DAY_COMMA_RE, "$1+");

  const tokens = line
    .split(SEPARATORS)
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length > 0);

  let name = "";
  let subject: string | null = null;
  let price: number | null = null;
  let debtAmount: number | null = null;
  let debtLessons: number | null = null;
  let prepayLessons: number | null = null;
  let prepayAmount: number | null = null;
  let durationMinutes: number | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let telegram: string | null = null;
  const schedule: ScheduleSlot[] = [];
  const noteParts: string[] = [];

  if (tokens.length <= 1) {
    // Без роздільників: «Марк Іваненко 600» / «Соломія».
    let rest = tokens[0] ?? "";
    const m = TRAILING_PRICE_RE.exec(rest);
    if (m) {
      price = num(m[1]);
      rest = rest.slice(0, m.index).trim();
    }
    name = rest;
  } else {
    name = tokens[0];
    for (const tok of tokens.slice(1)) {
      const pm = PRICE_RE.exec(tok);
      if (pm && price === null) { price = num(pm[1]); continue; }
      const d = parseDebt(tok);
      if (d) { if (d.lessons) debtLessons = d.lessons; else if (d.amount) debtAmount = d.amount; continue; }
      const p = parsePrepay(tok);
      if (p) { if (p.lessons) prepayLessons = p.lessons; else if (p.amount) prepayAmount = p.amount; continue; }
      const dm = /^(\d{2,3})\s*(?:хв|хвилин|min|minutes?)$/i.exec(tok);
      if (dm) { durationMinutes = Number(dm[1]); continue; }
      const em = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.exec(tok);
      if (em && email === null) { email = tok.toLowerCase(); continue; }
      if (/^@[a-z0-9_]{4,}$/i.test(tok) && telegram === null) { telegram = tok; continue; }
      if (/^\+?[\d\s()-]{9,}$/.test(tok) && tok.replace(/\D/g, "").length >= 9 && phone === null) {
        phone = tok.replace(/[\s()-]/g, "");
        continue;
      }
      const sl = parseSchedule(tok);
      if (sl) { schedule.push(...sl); continue; }
      // Предмет — коротке слово/два без цифр; довше або з цифрами — нотатка
      // («мама платить 1 числа» не має стати предметом).
      if (subject === null && !/\d/.test(tok) && tok.split(/\s+/).length <= 3 && tok.length <= 40) { subject = tok; continue; }
      noteParts.push(tok);
    }
  }

  const { firstName, lastName } = splitName(name);
  const okPrice = price !== null && Number.isFinite(price) && price > 0 ? price : null;
  const warnings: ImportWarning[] = [];
  if (debtLessons !== null && okPrice === null) warnings.push("debt_lessons_need_price");
  else if (debtAmount !== null && okPrice === null) warnings.push("debt_without_price");
  if ((debtAmount !== null || debtLessons !== null) && (prepayLessons !== null || prepayAmount !== null)) warnings.push("prepay_covers_debt");
  if (schedule.length > 0 && okPrice === null) warnings.push("schedule_without_price");

  return {
    raw,
    firstName,
    lastName,
    subject,
    price: okPrice,
    debtAmount,
    debtLessons,
    prepayLessons,
    prepayAmount,
    schedule,
    durationMinutes,
    phone,
    email,
    telegram,
    note: noteParts.length ? noteParts.join(" · ") : null,
    warnings,
    error: firstName ? null : "empty_name",
  };
}

// ── Таблиця з Excel / Google Таблиць ──────────────────────────────────────────
type Col = "name" | "surname" | "subject" | "price" | "debt" | "prepay" | "day" | "time" | "schedule" | "phone" | "email" | "telegram" | "note" | "duration" | null;

function headerCol(h: string): Col {
  const w = h.toLowerCase().replace(/['ʼ’`]/g, "").trim();
  if (/^(імя|имя|name|student|учень|учні|ім'я|full name|піб)$/.test(w)) return "name";
  if (/^(прізвище|surname|last name)$/.test(w)) return "surname";
  if (/^(предмет|subject|ämne)$/.test(w)) return "subject";
  if (/^(ціна|цена|price|rate|ставка|вартість|pris)$/.test(w)) return "price";
  if (/^(борг|debt|заборгованість|skuld)$/.test(w)) return "debt";
  if (/^(передоплата|передплата|аванс|prepaid|prepay|prepayment|förskott)$/.test(w)) return "prepay";
  if (/^(день|дні|день тижня|day|weekday|дн)$/.test(w)) return "day";
  if (/^(час|time|tid)$/.test(w)) return "time";
  if (/^(розклад|schedule|schema)$/.test(w)) return "schedule";
  if (/^(телефон|phone|тел|mobile|телефон батьків)$/.test(w)) return "phone";
  if (/^(пошта|email|e-mail|mail|epost|e-post)$/.test(w)) return "email";
  if (/^(telegram|тг|телеграм)$/.test(w)) return "telegram";
  if (/^(нотатка|коментар|note|notes|comment|примітка)$/.test(w)) return "note";
  if (/^(тривалість|duration|хв)$/.test(w)) return "duration";
  return null;
}

function looksLikeTable(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  const first = lines[0].split("\t");
  if (first.length < 2) return false;
  const cols = first.map(headerCol);
  return cols.some((c) => c === "name") && cols.filter(Boolean).length >= 2;
}

function tableToLines(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = lines[0].split("\t").map(headerCol);
  const out: string[] = [];
  for (const row of lines.slice(1)) {
    const cells = row.split("\t").map((c) => c.trim());
    const get = (c: Col) => cols.map((k, i) => (k === c ? cells[i] ?? "" : "")).filter(Boolean).join(" ").trim();
    const name = [get("name"), get("surname")].filter(Boolean).join(" ");
    if (!name) continue;
    const parts: string[] = [name];
    const subj = get("subject"); if (subj) parts.push(subj);
    const price = get("price"); if (price) parts.push(price);
    const debt = get("debt"); if (debt) parts.push(/^\d/.test(debt) ? `борг ${debt}` : debt);
    const prepay = get("prepay"); if (prepay) parts.push(/^\d/.test(prepay) ? `передоплата ${prepay}` : prepay);
    const sched = get("schedule"); const day = get("day"); const time = get("time");
    if (sched) parts.push(sched);
    else if (day && time) parts.push(`${day} ${time}`);
    const dur = get("duration"); if (dur) parts.push(/хв|min/i.test(dur) ? dur : `${dur} хв`);
    const phone = get("phone"); if (phone) parts.push(phone);
    const email = get("email"); if (email) parts.push(email);
    const tg = get("telegram"); if (tg) parts.push(tg.startsWith("@") ? tg : `@${tg}`);
    const note = get("note"); if (note) parts.push(note);
    out.push(parts.join(" — "));
  }
  return out;
}

export function parseStudentList(text: string): ParsedStudent[] {
  const lines = looksLikeTable(text) ? tableToLines(text) : text.split(/\r?\n/);
  return lines
    .map(parseStudentLine)
    .filter((r): r is ParsedStudent => r !== null);
}

// ── Нетто борг/передоплата та дати уроків — рахує клієнт ─────────────────────

export interface ImportPayload {
  debtAmount: number;
  debtLessons: number;
  prepayLessons: number;
  prepayAmount: number;
}

/**
 * Борг і передоплата одного учня зводяться в нетто ДО запису — інакше
 * гаманець одразу погасив би те, що ми щойно створили. Різні одиниці
 * (уроки vs гроші) зводяться через ставку; без ставки — лишаються як є.
 */
/**
 * Горизонт розкладу імпорту = 4 тижні. Живе ТУТ, а не в компоненті, бо на це
 * число спирається і лендінговий калькулятор: два екрани — одна константа.
 */
export const IMPORT_SCHEDULE_WEEKS = 4;

export function netDebtAndPrepay(r: ParsedStudent): ImportPayload {
  let debtAmount = r.debtAmount ?? 0;
  let debtLessons = r.debtLessons ?? 0;
  let prepayLessons = r.prepayLessons ?? 0;
  let prepayAmount = r.prepayAmount ?? 0;
  const price = r.price ?? 0;
  // Приводимо до однієї одиниці, якщо є ставка.
  if (price > 0) {
    if (debtLessons > 0) { debtAmount += debtLessons * price; debtLessons = 0; }
    if (prepayLessons > 0 && debtAmount > 0) { prepayAmount += prepayLessons * price; prepayLessons = 0; }
  }
  if (debtAmount > 0 && prepayAmount > 0) {
    const net = debtAmount - prepayAmount;
    debtAmount = Math.max(0, net);
    prepayAmount = Math.max(0, -net);
  }
  if (debtLessons > 0 && prepayLessons > 0) {
    const net = debtLessons - prepayLessons;
    debtLessons = Math.max(0, net);
    prepayLessons = Math.max(0, -net);
  }
  return { debtAmount, debtLessons, prepayLessons, prepayAmount };
}

/** Дати уроків на N тижнів уперед від найближчого входження (локальний час). */
export function scheduleToStarts(slots: ScheduleSlot[], weeks: number, now: Date = new Date()): Date[] {
  const out: Date[] = [];
  for (const s of slots) {
    const [hh, mm] = s.time.split(":").map(Number);
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setHours(hh, mm, 0, 0);
    // ISO weekday: JS getDay() 0=нд → 7
    const jsDay = d.getDay() === 0 ? 7 : d.getDay();
    let delta = (s.weekday - jsDay + 7) % 7;
    if (delta === 0 && d.getTime() <= now.getTime()) delta = 7;
    d.setDate(d.getDate() + delta);
    for (let i = 0; i < weeks; i++) {
      out.push(new Date(d.getTime() + i * 7 * 86400000));
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
