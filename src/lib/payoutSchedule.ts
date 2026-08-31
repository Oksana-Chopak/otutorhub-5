// Розрахунок графіка виплат репетиторам.
// Кожен репетитор має власну періодичність на tutor_details.

import i18n from "@/i18n";
import { lazyArray } from "@/lib/lazyI18n";

export type PayoutFrequency = "weekly" | "biweekly" | "monthly";

export interface PayoutSchedule {
  payout_frequency: string | null;
  payout_weekday: number | null;   // 0..6 (нд..сб)
  payout_monthday: number | null;  // 1..28
  payout_anchor: string | null;    // опорна дата для biweekly (ISO)
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Чи сьогодні день виплати за графіком цього репетитора. */
export function isPayoutDueToday(s: PayoutSchedule, today = new Date()): boolean {
  if (!s.payout_frequency) return false;
  const t = startOfDay(today);

  if (s.payout_frequency === "weekly") {
    return s.payout_weekday != null && t.getDay() === s.payout_weekday;
  }
  if (s.payout_frequency === "biweekly") {
    if (s.payout_weekday == null || t.getDay() !== s.payout_weekday) return false;
    // Парність тижнів від опорної дати (або від epoch, якщо anchor не задано).
    const anchor = s.payout_anchor ? startOfDay(new Date(s.payout_anchor)) : new Date(0);
    const weeks = Math.round((t.getTime() - startOfDay(anchor).getTime()) / (7 * DAY));
    return weeks % 2 === 0;
  }
  if (s.payout_frequency === "monthly") {
    if (s.payout_monthday == null) return false;
    // 28+ або кінець місяця трактуємо як «останній день», але ми обмежуємо 1..28 у формі.
    return t.getDate() === s.payout_monthday;
  }
  return false;
}

/** Наступна дата виплати (для підпису «наступна: пт, 14 черв.»). null якщо без графіка. */
export function nextPayoutDate(s: PayoutSchedule, from = new Date()): Date | null {
  if (!s.payout_frequency) return null;
  const start = startOfDay(from);

  if (s.payout_frequency === "weekly" && s.payout_weekday != null) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * DAY);
      if (d.getDay() === s.payout_weekday) return d;
    }
  }
  if (s.payout_frequency === "biweekly" && s.payout_weekday != null) {
    for (let i = 0; i < 14; i++) {
      const d = new Date(start.getTime() + i * DAY);
      if (isPayoutDueToday(s, d)) return d;
    }
  }
  if (s.payout_frequency === "monthly" && s.payout_monthday != null) {
    const d = new Date(start);
    if (d.getDate() <= s.payout_monthday) {
      d.setDate(s.payout_monthday);
      return d;
    }
    d.setMonth(d.getMonth() + 1, s.payout_monthday);
    return d;
  }
  return null;
}

// A1: ліниві масиви — переклад у момент звернення, не імпорту (див. lazyI18n.ts)
const WEEKDAYS_UK: readonly string[] = lazyArray(() => [
  i18n.t("payoutSchedule.weekdaySun"),
  i18n.t("payoutSchedule.weekdayMon"),
  i18n.t("payoutSchedule.weekdayTue"),
  i18n.t("payoutSchedule.weekdayWed"),
  i18n.t("payoutSchedule.weekdayThu"),
  i18n.t("payoutSchedule.weekdayFri"),
  i18n.t("payoutSchedule.weekdaySat"),
]);
const WEEKDAYS_UK_SHORT: readonly string[] = lazyArray(() => [
  i18n.t("payoutSchedule.weekdayShortSun"),
  i18n.t("payoutSchedule.weekdayShortMon"),
  i18n.t("payoutSchedule.weekdayShortTue"),
  i18n.t("payoutSchedule.weekdayShortWed"),
  i18n.t("payoutSchedule.weekdayShortThu"),
  i18n.t("payoutSchedule.weekdayShortFri"),
  i18n.t("payoutSchedule.weekdayShortSat"),
]);

/** Людський опис графіка: «щоп'ятниці», «раз на 2 тижні (пн)», «5 числа щомісяця». */
export function describePayoutSchedule(s: PayoutSchedule): string | null {
  if (!s.payout_frequency) return null;
  if (s.payout_frequency === "weekly" && s.payout_weekday != null) {
    return i18n.t("payoutSchedule.weekly", { weekday: WEEKDAYS_UK[s.payout_weekday] });
  }
  if (s.payout_frequency === "biweekly" && s.payout_weekday != null) {
    return i18n.t("payoutSchedule.biweekly", { weekday: WEEKDAYS_UK[s.payout_weekday] });
  }
  if (s.payout_frequency === "monthly" && s.payout_monthday != null) {
    return i18n.t("payoutSchedule.monthly", { monthday: s.payout_monthday });
  }
  return null;
}

export { WEEKDAYS_UK, WEEKDAYS_UK_SHORT };
