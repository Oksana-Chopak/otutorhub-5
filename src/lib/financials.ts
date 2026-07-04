/**
 * financials.ts — the ONE place for the hub money math (MON-2).
 *
 * profit = Σ paid student_price − Σ paid tutor_payout
 *
 * This exact formula (and the "billable" predicate feeding it) used to be
 * re-implemented inline ~10x across FinancesPage and DashboardPage, with the
 * two pages' predicates free to drift apart — meaning Dashboard and Finances
 * could show different profit for the same lessons. Locked by
 * src/test/financials.test.ts. Any money-math change happens HERE.
 */

export interface MoneyLesson {
  starts_at: string;
  status: string;
  student_price: number | string | null;
  tutor_payout: number | string | null;
  student_payment_status: string | null;
  tutor_payout_status: string | null;
  /** Cancelled lesson whose student_price is a withheld cancellation FEE
   * (lesson_details.is_cancellation_fee) — the only cancelled rows that bill. */
  is_cancellation_fee?: boolean | null;
}

/**
 * A lesson counts toward money totals when it isn't cancelled/pending AND it
 * either already happened (completed or in the past) or already has a payment
 * marked on either side (pre-paid future lessons still count).
 */
export const isBillableLesson = (l: MoneyLesson, nowMs: number = Date.now()): boolean => {
  if (l.status === "cancelled") {
    // A cancelled lesson bills ONLY when it carries an explicit cancellation fee
    // (approve-with-charge sets the marker). A bare price>0 test would misbill
    // every directly-cancelled lesson, which keeps its old snapshot price.
    return l.is_cancellation_fee === true && Number(l.student_price ?? 0) > 0;
  }
  if (l.status === "pending") return false;
  if (l.status === "completed") return true;
  const isPast = new Date(l.starts_at).getTime() < nowMs;
  const hasPayment = l.student_payment_status === "paid" || l.tutor_payout_status === "paid";
  return isPast || hasPayment;
};

export const paidIncome = (rows: MoneyLesson[]): number =>
  rows
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price ?? 0), 0);

export const paidExpense = (rows: MoneyLesson[]): number =>
  rows
    .filter((l) => l.tutor_payout_status === "paid")
    .reduce((s, l) => s + Number(l.tutor_payout ?? 0), 0);

/** Hub margin over a set of lessons: paid income − paid payouts. */
export const paidProfit = (rows: MoneyLesson[]): number => paidIncome(rows) - paidExpense(rows);

export const unpaidIncome = (rows: MoneyLesson[]): number =>
  rows
    .filter((l) => l.student_payment_status === "unpaid")
    .reduce((s, l) => s + Number(l.student_price ?? 0), 0);

export const unpaidExpense = (rows: MoneyLesson[]): number =>
  rows
    .filter((l) => l.tutor_payout_status === "unpaid")
    .reduce((s, l) => s + Number(l.tutor_payout ?? 0), 0);

/**
 * Sum amounts grouped by currency, dropping zero buckets. Entries come back
 * sorted by |sum| descending, so entries[0] is the dominant currency — the one
 * a compact card should headline, with the rest as a small "+ …" suffix.
 * Mixing currencies into one number is meaningless; this is the shared way out.
 */
export function sumByCurrency<T>(
  rows: T[],
  amount: (r: T) => number,
  currency: (r: T) => string | null | undefined
): Array<[string, number]> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const a = amount(r);
    if (!a) continue;
    const c = currency(r) || "UAH";
    out[c] = (out[c] ?? 0) + a;
  }
  return Object.entries(out).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
}

/**
 * Gross margin %: (income − payout) / income · 100 over rows that carry BOTH
 * sides of the money (price > 0 and payout > 0). null when not computable.
 */
export const grossMarkupPct = (rows: MoneyLesson[]): number | null => {
  const valid = rows.filter(
    (l) => Number(l.student_price ?? 0) > 0 && Number(l.tutor_payout ?? 0) > 0
  );
  if (valid.length === 0) return null;
  const income = valid.reduce((s, l) => s + Number(l.student_price ?? 0), 0);
  const payout = valid.reduce((s, l) => s + Number(l.tutor_payout ?? 0), 0);
  if (income === 0) return null;
  return ((income - payout) / income) * 100;
};
