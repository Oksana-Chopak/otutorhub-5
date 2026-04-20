// Time helpers — minutes since midnight in local timezone
export const WEEKDAYS_UK = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;
export const WEEKDAYS_FULL_UK = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П'ятниця",
  "Субота",
] as const;

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

// Compute available intervals for a single date, taking weekly + overrides + booked lessons.
export const computeAvailableForDate = (
  date: Date,
  weekly: WeeklyRow[],
  overrides: OverrideRow[],
  booked: BookedRow[]
): Interval[] => {
  const isoDate = toLocalISODate(date);
  const dayOverrides = overrides.filter((o) => o.slot_date === isoDate);

  const baseFromWeekly = weekly
    .filter((w) => w.weekday === date.getDay())
    .map((w) => ({ start: w.start_minute, end: w.end_minute }));

  const additions = dayOverrides
    .filter((o) => o.is_available)
    .map((o) => ({ start: o.start_minute, end: o.end_minute }));

  const blockers = dayOverrides
    .filter((o) => !o.is_available)
    .map((o) => ({ start: o.start_minute, end: o.end_minute }));

  // Booked lessons (convert to local minutes for that date only)
  const bookedBlockers: Interval[] = booked
    .map((b) => {
      const start = new Date(b.starts_at);
      if (toLocalISODate(start) !== isoDate) return null;
      const startMin = start.getHours() * 60 + start.getMinutes();
      return { start: startMin, end: startMin + b.duration_minutes };
    })
    .filter((x): x is Interval => x !== null);

  let combined = mergeIntervals([...baseFromWeekly, ...additions]);
  for (const blk of [...blockers, ...bookedBlockers]) {
    combined = combined.flatMap((c) => subtractIntervals(c, [blk]));
  }
  return combined.filter((i) => i.end > i.start);
};

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
