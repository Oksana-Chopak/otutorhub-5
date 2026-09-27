/**
 * studentGamification — ЄДИНА математика гейміфікації учня.
 *
 * Чому окремий чистий модуль. До 27.09 в учня було ТРИ поверхні
 * (дашборд, `/student/achievements`, `/achievements`), кожна рахувала своє:
 * рівень жив у `StudentProgressBar`, емодзі-нагороди — у двох різних копіях
 * полиці, сім ачівок — окремо. Одна людина бачила три різні «прогреси» і
 * жодного числа, яке б поверталo її завтра. Тут лежить рівно одна реалізація
 * серії й цілі тижня; поверхні лише малюють.
 *
 * ОДИНИЦЯ СЕРІЇ — ТИЖДЕНЬ, не день. Це не спрощення, а честність: уроки
 * бувають 1–2 рази на тиждень, і денна серія в такому продукті ГАРАНТОВАНО
 * обривається — тобто щодня казала б людині, що вона програла. Тижнева серія
 * збігається з ачівкою `week_streak` (4 тижні) — одне поняття, не два.
 *
 * Тижні рахуються по понеділках (місцевий час), як `maxConsecutiveWeeks` у
 * `studentAchievements` — другої тижневої математики в застосунку немає.
 */

const DAY = 86_400_000;

/** Понеділок тижня цієї дати (місцева північ). */
export function mondayOf(d: Date): number {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sinceMonday = (day.getDay() + 6) % 7; // getDay(): 0=Нд..6=Сб
  return day.getTime() - sinceMonday * DAY;
}

export interface WeeklyStreak {
  /** Серія, що ЖИВА зараз: скінчилась цього або минулого тижня. 0 = обірвана. */
  current: number;
  /** Найдовша серія за всю історію (для «рекорд: N»). */
  longest: number;
  /** Скільки проведених уроків уже є цього тижня. */
  thisWeekCount: number;
}

/**
 * Серія тижнів із проведеними уроками.
 *
 * Тонкість, яку легко зламати: поки ТИЖДЕНЬ НЕ СКІНЧИВСЯ, серія ще не
 * обірвана. Тому серія, останній тиждень якої — минулий, лишається живою
 * (`current > 0`), просто під ризиком. Якби ми обнуляли її в понеділок,
 * людина відкривала б застосунок у вівторок і бачила «0» — саме тоді, коли
 * її ще можна врятувати одним уроком.
 */
export function weeklyStreak(completedStarts: string[], now: number = Date.now()): WeeklyStreak {
  const thisMonday = mondayOf(new Date(now));
  const lastMonday = thisMonday - 7 * DAY;

  const mondays = new Set<number>();
  let thisWeekCount = 0;
  for (const iso of completedStarts) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const m = mondayOf(d);
    // Майбутні тижні в серію не входять: урок, який ще не відбувся, нічого
    // не доводить (статус 'completed' у майбутньому можливий — репетитор
    // позначає наперед).
    if (m > thisMonday) continue;
    mondays.add(m);
    if (m === thisMonday) thisWeekCount += 1;
  }
  if (mondays.size === 0) return { current: 0, longest: 0, thisWeekCount: 0 };

  const sorted = Array.from(mondays).sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] === 7 * DAY) { run += 1; longest = Math.max(longest, run); }
    else run = 1;
  }

  const last = sorted[sorted.length - 1];
  let current = 0;
  if (last === thisMonday || last === lastMonday) {
    current = 1;
    for (let i = sorted.length - 1; i > 0; i--) {
      if (sorted[i] - sorted[i - 1] === 7 * DAY) current += 1;
      else break;
    }
  }
  return { current, longest: Math.max(longest, current), thisWeekCount };
}

/**
 * Стан серії.
 *
 * `atRisk` ставиться ЛИШЕ коли людина справді може щось зробити: цього тижня
 * уроку не було І жодного не заплановано. Якщо урок у розкладі є — серія не
 * під загрозою, і попередження було б шумом («зроби щось» там, де робити
 * нічого не треба, вчить ігнорувати попередження).
 */
export type StreakState = "none" | "alive" | "atRisk";

export function streakState(args: {
  current: number;
  thisWeekCount: number;
  scheduledLeftThisWeek: number;
}): StreakState {
  if (args.current <= 0) return "none";
  if (args.thisWeekCount > 0) return "alive";
  if (args.scheduledLeftThisWeek > 0) return "alive";
  return "atRisk";
}

/** Скільки днів лишилось до кінця тижня включно з сьогоднішнім (Нд = 1). */
export function daysLeftInWeek(now: number = Date.now()): number {
  const d = new Date(now);
  const day = d.getDay(); // 0=Нд
  return day === 0 ? 1 : 8 - day;
}

export interface WeekGoal {
  lessonsDone: number;
  /** Заплановано + проведено цього тижня. 0 = уроків цього тижня взагалі немає. */
  lessonsTarget: number;
  homeworkDone: number;
  /** Уроки цього тижня, де репетитор ЗАДАВ домашку. 0 = рядок не показуємо. */
  homeworkTarget: number;
}

/**
 * Ціль тижня з РЕАЛЬНИХ даних. Жодне число не вигадується: ціль по уроках —
 * це те, що справді стоїть у розкладі, а не «норма». Якщо уроків на тижні
 * немає (`lessonsTarget === 0`), поверхня каже це словами й дає дію, а не
 * малює 0 з 1 — бо це була б вимога, якої людина не ставила.
 */
export function weekGoal(args: {
  lessons: Array<{ id: string; starts_at: string; status: string }>;
  homeworkLessonIds: ReadonlySet<string>;
  homeworkDoneIds: ReadonlySet<string>;
  now?: number;
}): WeekGoal {
  const thisMonday = mondayOf(new Date(args.now ?? Date.now()));
  let lessonsDone = 0;
  let scheduled = 0;
  let homeworkTarget = 0;
  let homeworkDone = 0;
  for (const l of args.lessons) {
    const d = new Date(l.starts_at);
    if (Number.isNaN(d.getTime()) || mondayOf(d) !== thisMonday) continue;
    if (l.status === "completed") lessonsDone += 1;
    else if (l.status === "scheduled") scheduled += 1;
    if (args.homeworkLessonIds.has(l.id)) {
      homeworkTarget += 1;
      if (args.homeworkDoneIds.has(l.id)) homeworkDone += 1;
    }
  }
  return { lessonsDone, lessonsTarget: lessonsDone + scheduled, homeworkDone, homeworkTarget };
}

/** Скільки уроків ще стоїть у розкладі до кінця цього тижня (для стану серії). */
export function scheduledLeftThisWeek(
  lessons: Array<{ starts_at: string; status: string }>,
  now: number = Date.now(),
): number {
  const thisMonday = mondayOf(new Date(now));
  let n = 0;
  for (const l of lessons) {
    if (l.status !== "scheduled") continue;
    const d = new Date(l.starts_at);
    if (Number.isNaN(d.getTime())) continue;
    if (mondayOf(d) === thisMonday && d.getTime() >= now) n += 1;
  }
  return n;
}
