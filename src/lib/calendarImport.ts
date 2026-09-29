/**
 * Google Календар → рядки імпорту (29.09, «Перенести все, що є», частина 2).
 *
 * Вхід — прості події з edge `google-calendar-import` (назва, початок, кінець,
 * чи повторюється). Вихід — ТІ САМІ рядки, що читає імпорт («Марія — англійська —
 * пн 18:00, чт 18:00 — 60 хв»), тож далі працює той самий парсер і той самий
 * екран підтвердження. Учнем стає лише те, що повторюється: повторювана подія або
 * та сама назва двічі в один день тижня й час. Разові події чесно перелічуються
 * як пропущені — жодного учня «з нічого».
 */
import { SUBJECT_WORD_RE, type ScheduleSlot, type CanonicalWords } from "@/lib/importStudents";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string; // ISO з офсетом
  end: string;
  recurring: boolean;
}

export interface CalendarStudent {
  name: string;
  subject: string | null;
  slots: ScheduleSlot[];
  durationMinutes: number;
  occurrences: number;
}

export interface CalendarImport {
  students: CalendarStudent[];
  skipped: Array<{ title: string; reason: "once" | "no_name" }>;
}

const NOISE_RE = /^(?:урок|уроки|заняття|lesson|lektion|with|з|зі|із|та|і|and|репетитор|tutor|онлайн|online|zoom|meet|google)$/i;

/** «Урок: Англійська — Марія (онлайн)» → { name: "Марія", subject: "Англійська" } */
export function splitTitle(summary: string): { name: string; subject: string | null } {
  const words = summary
    .replace(/[()[\]«»"“”|]/g, " ")
    .replace(/[—–:/,]+/g, " ")
    .replace(/\s+-\s+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const name: string[] = [];
  const subject: string[] = [];
  for (const w of words) {
    if (NOISE_RE.test(w)) continue;
    if (SUBJECT_WORD_RE.test(w)) subject.push(w);
    else if (!/^\d/.test(w) && name.length < 4) name.push(w);
  }
  return { name: name.join(" "), subject: subject.length ? subject.join(" ") : null };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function eventsToStudents(events: CalendarEvent[]): CalendarImport {
  const groups = new Map<string, { name: string; subject: string | null; slots: Map<string, number>; durations: number[]; recurring: boolean; occurrences: number; title: string }>();
  const skipped: CalendarImport["skipped"] = [];
  for (const e of events) {
    const { name, subject } = splitTitle(e.summary);
    if (!name) { skipped.push({ title: e.summary || "—", reason: "no_name" }); continue; }
    const start = new Date(e.start);
    const end = new Date(e.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const weekday = start.getDay() === 0 ? 7 : start.getDay();
    const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const key = `${name.toLowerCase()}|${(subject ?? "").toLowerCase()}`;
    const g = groups.get(key) ?? { name, subject, slots: new Map(), durations: [], recurring: false, occurrences: 0, title: e.summary };
    const slotKey = `${weekday}|${time}`;
    g.slots.set(slotKey, (g.slots.get(slotKey) ?? 0) + 1);
    g.durations.push(Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000 / 5) * 5));
    g.recurring = g.recurring || e.recurring;
    g.occurrences += 1;
    groups.set(key, g);
  }
  const students: CalendarStudent[] = [];
  for (const g of groups.values()) {
    // Повторюване: або Google каже «повторюється», або та сама назва ≥2 разів в один слот.
    const repeatingSlots = [...g.slots.entries()].filter(([, n]) => g.recurring || n >= 2);
    if (!repeatingSlots.length) { skipped.push({ title: g.title, reason: "once" }); continue; }
    const slots: ScheduleSlot[] = repeatingSlots
      .map(([k]) => { const [wd, t] = k.split("|"); return { weekday: Number(wd), time: t }; })
      .sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
    const sorted = [...g.durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 60;
    students.push({ name: g.name, subject: g.subject, slots, durationMinutes: median, occurrences: g.occurrences });
  }
  students.sort((a, b) => a.name.localeCompare(b.name));
  return { students, skipped };
}

/** Рядки імпорту — рівно ті, що читає parseStudentList. */
export function calendarToImportText(imp: CalendarImport, kw: CanonicalWords): string {
  return imp.students
    .map((s) => {
      const parts = [s.name];
      if (s.subject) parts.push(s.subject);
      parts.push(s.slots.map((sl) => `${kw.day(sl.weekday)} ${sl.time}`).join(", "));
      if (s.durationMinutes !== 60) parts.push(`${s.durationMinutes} ${kw.min}`);
      return parts.join(" — ");
    })
    .join("\n");
}
