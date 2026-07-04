/**
 * studentStats — shared weekly-progress math for the student surfaces.
 *
 * The dashboard and the profile used to compute "this week" and "weekly record"
 * independently (the profile even passed the CURRENT week's count as the
 * all-time record), so the two pages showed different numbers for the same
 * student. One implementation, ISO-week semantics.
 */

export function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)}`;
}

/** Completed-lesson start dates → { thisWeek count, all-time best week }. */
export function computeWeeklyStats(completedStartDates: string[]): {
  weeklyCount: number;
  weeklyRecord: number;
} {
  const thisWeek = getISOWeek(new Date());
  const byWeek: Record<string, number> = {};
  for (const iso of completedStartDates) {
    const wk = getISOWeek(new Date(iso));
    byWeek[wk] = (byWeek[wk] ?? 0) + 1;
  }
  return {
    weeklyCount: byWeek[thisWeek] ?? 0,
    weeklyRecord: Math.max(0, ...Object.values(byWeek)),
  };
}
