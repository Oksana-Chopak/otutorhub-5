import i18n from "@/i18n";
import { lazyArray } from "@/lib/lazyI18n";
import { wallInZone, wallToInstant } from "@/lib/timeZone";

// Time helpers — minutes since midnight in local timezone
export const WEEKDAYS_UK = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;
// A1: лінивий масив — переклад береться в момент звернення, не в момент імпорту
// (інакше з лінивими локалями тут були б сирі ключі, а зміна мови не діяла б).
export const WEEKDAYS_FULL_UK: readonly string[] = lazyArray(() => [
  i18n.t("weekdays.sun"),
  i18n.t("weekdays.mon"),
  i18n.t("weekdays.tue"),
  i18n.t("weekdays.wed"),
  i18n.t("weekdays.thu"),
  i18n.t("weekdays.fri"),
  i18n.t("weekdays.sat"),
]);

export const minutesToHHMM = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

export const hhmmToMinutes = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

export interface Interval {
  start: number; // minutes from midnight
  end: number;
}

// Subtract list of intervals B from interval A
export const subtractIntervals = (base: Interval, blockers: Interval[]): Interval[] => {
  let out: Interval[] = [{ ...base }];
  for (const b of blockers) {
    const next: Interval[] = [];
    for (const a of out) {
      if (b.end <= a.start || b.start >= a.end) {
        next.push(a);
        continue;
      }
      if (b.start > a.start) next.push({ start: a.start, end: Math.min(b.start, a.end) });
      if (b.end < a.end) next.push({ start: Math.max(b.end, a.start), end: a.end });
    }
    out = next.filter((i) => i.end > i.start);
  }
  return out;
};

// Merge overlapping/adjacent intervals
export const mergeIntervals = (items: Interval[]): Interval[] => {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
};

export interface WeeklyRow {
  id?: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
}
export interface OverrideRow {
  id?: string;
  slot_date: string; // YYYY-MM-DD
  start_minute: number;
  end_minute: number;
  is_available: boolean;
}
export interface BookedRow {
  starts_at: string; // ISO
  duration_minutes: number;
}

const toLocalISODate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Зайнятий урок у «настінному» часі якогось поясу: дата, хвилини від півночі, тривалість. */
export interface BookedWall { isoDate: string; startMin: number; duration: number }

/**
 * Вільні проміжки одного календарного дня — чиста арифметика над «настінним» часом, без жодного
 * поясу: день заданий датою й днем тижня, уроки — вже в тому самому часі. Пояс вирішує той, хто
 * кличе (14.11: години репетитора записані ЙОГО місцевим часом).
 */
export const computeAvailableForDay = (
  isoDate: string,
  weekday: number,
  weekly: WeeklyRow[],
  overrides: OverrideRow[],
  booked: BookedWall[],
): Interval[] => {
  const dayOverrides = overrides.filter((o) => o.slot_date === isoDate);

  const baseFromWeekly = weekly
    .filter((w) => w.weekday === weekday)
    .map((w) => ({ start: w.start_minute, end: w.end_minute }));

  const additions = dayOverrides
    .filter((o) => o.is_available)
    .map((o) => ({ start: o.start_minute, end: o.end_minute }));

  const blockers = dayOverrides
    .filter((o) => !o.is_available)
    .map((o) => ({ start: o.start_minute, end: o.end_minute }));

  const bookedBlockers: Interval[] = booked
    .filter((b) => b.isoDate === isoDate)
    .map((b) => ({ start: b.startMin, end: b.startMin + b.duration }));

  let combined = mergeIntervals([...baseFromWeekly, ...additions]);
  for (const blk of [...blockers, ...bookedBlockers]) {
    combined = combined.flatMap((c) => subtractIntervals(c, [blk]));
  }
  return combined.filter((i) => i.end > i.start);
};

// Compute available intervals for a single date, taking weekly + overrides + booked lessons.
// Усе — за поясом пристрою (той, хто дивиться, і є репетитор, або вони в одному поясі).
export const computeAvailableForDate = (
  date: Date,
  weekly: WeeklyRow[],
  overrides: OverrideRow[],
  booked: BookedRow[]
): Interval[] =>
  computeAvailableForDay(
    toLocalISODate(date),
    date.getDay(),
    weekly,
    overrides,
    booked.map((b) => {
      const start = new Date(b.starts_at);
      return { isoDate: toLocalISODate(start), startMin: start.getHours() * 60 + start.getMinutes(), duration: b.duration_minutes };
    }),
  );

/**
 * Вільні слоти репетитора ОЧИМА ЛЮДИНИ В ІНШОМУ ПОЯСІ (14.11).
 *
 * Години доступності записані місцевим часом репетитора («пн 10:00–14:00» у Києві). Раніше їх
 * показували як є, а зайняті уроки віднімали за поясом того, хто дивиться, — менеджерка в
 * Стокгольмі бачила вікна зі зсувом на годину і з «вільними» слотами, де насправді стоїть урок.
 * Тепер рахуємо в часі репетитора, а кожен слот переводимо в момент часу й показуємо на годиннику
 * глядача. Слот, що перейшов через північ, потрапляє в сусідній день глядача.
 *
 * `viewerDates` — дні глядача («YYYY-MM-DD» за ЙОГО поясом), які малює екран.
 */
export function slotsForViewer(opts: {
  viewerDates: string[];
  weekly: WeeklyRow[];
  overrides: OverrideRow[];
  booked: BookedRow[];
  tutorTz: string;
  viewerTz: string;
  slotMinutes: number;
  now?: Date;
}): Record<string, Interval[]> {
  const { viewerDates, weekly, overrides, booked, tutorTz, viewerTz, slotMinutes } = opts;
  const now = opts.now ?? new Date();
  const out: Record<string, Interval[]> = {};
  for (const d of viewerDates) out[d] = [];

  const bookedWall: BookedWall[] = booked.map((b) => {
    const w = wallInZone(new Date(b.starts_at), tutorTz);
    return { isoDate: w.iso, startMin: w.minutes, duration: b.duration_minutes };
  });

  // дні репетитора, які можуть зачепити дні глядача: кожен день і його сусіди
  const tutorDates = new Set<string>();
  for (const d of viewerDates) {
    const [y, m, day] = d.split("-").map(Number);
    for (const shift of [-1, 0, 1]) {
      const t = new Date(Date.UTC(y, m - 1, day + shift));
      tutorDates.add(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`);
    }
  }
  for (const iso of tutorDates) {
    const [y, m, day] = iso.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    const slots = splitIntoSlots(computeAvailableForDay(iso, weekday, weekly, overrides, bookedWall), slotMinutes);
    for (const s of slots) {
      const at = wallToInstant(iso, s.start, tutorTz);
      if (at.getTime() <= now.getTime()) continue;
      const v = wallInZone(at, viewerTz);
      if (out[v.iso]) out[v.iso].push({ start: v.minutes, end: v.minutes + slotMinutes });
    }
  }
  for (const d of viewerDates) out[d].sort((a, b) => a.start - b.start);
  return out;
}

// Split an interval into fixed-duration slots (e.g. 60-min)
export const splitIntoSlots = (intervals: Interval[], slotMinutes: number): Interval[] => {
  const out: Interval[] = [];
  for (const i of intervals) {
    let s = i.start;
    while (s + slotMinutes <= i.end) {
      out.push({ start: s, end: s + slotMinutes });
      s += slotMinutes;
    }
  }
  return out;
};

// Build a date for given local date + minute offset
export const buildLocalDate = (date: Date, minutes: number): Date => {
  const d = new Date(date);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
};

export { toLocalISODate };
