// Графік виплат репетиторам — edge-копія src/lib/payoutSchedule.ts (без i18n).
// Одна логіка на три місця: застосунок (картка «Час виплати»), payout-reminders
// (нагадування в день виплати) і ранковий дайджест менеджера (13.09: «⏰ день
// виплати сьогодні» біля репетитора, якому школа винна).

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

/** Чи сьогодні день виплати за графіком цього репетитора (today — локальний час Києва). */
export function isPayoutDueToday(s: PayoutSchedule, today: Date): boolean {
  if (!s.payout_frequency) return false;
  const t = startOfDay(today);
  if (s.payout_frequency === "weekly") {
    return s.payout_weekday != null && t.getDay() === s.payout_weekday;
  }
  if (s.payout_frequency === "biweekly") {
    if (s.payout_weekday == null || t.getDay() !== s.payout_weekday) return false;
    const anchor = s.payout_anchor ? startOfDay(new Date(s.payout_anchor)) : new Date(0);
    const weeks = Math.round((t.getTime() - startOfDay(anchor).getTime()) / (7 * DAY));
    return weeks % 2 === 0;
  }
  if (s.payout_frequency === "monthly") {
    return s.payout_monthday != null && t.getDate() === s.payout_monthday;
  }
  return false;
}

/** «Зараз» у київському настінному часі — щоб день тижня/число збігались із тим, що бачить менеджер. */
export function kyivNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
}
