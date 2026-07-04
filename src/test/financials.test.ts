import { describe, it, expect } from "vitest";
import {
  isBillableLesson,
  paidIncome,
  paidExpense,
  paidProfit,
  unpaidIncome,
  unpaidExpense,
  grossMarkupPct,
  sumByCurrency,
  type MoneyLesson,
} from "@/lib/financials";

const NOW = new Date("2026-07-01T12:00:00Z").getTime();
const mk = (over: Partial<MoneyLesson>): MoneyLesson => ({
  starts_at: "2026-06-01T10:00:00Z",
  status: "completed",
  student_price: 500,
  tutor_payout: 300,
  student_payment_status: "paid",
  tutor_payout_status: "paid",
  ...over,
});

describe("isBillableLesson (the shared billable predicate)", () => {
  it("excludes cancelled and pending regardless of payments", () => {
    expect(isBillableLesson(mk({ status: "cancelled" }), NOW)).toBe(false);
    expect(isBillableLesson(mk({ status: "pending" }), NOW)).toBe(false);
  });
  it("bills a cancelled lesson ONLY with the explicit cancellation-fee marker + a price", () => {
    // fee charged via approve-with-charge → counts toward money totals
    expect(isBillableLesson(mk({ status: "cancelled", is_cancellation_fee: true, student_price: 250 }), NOW)).toBe(true);
    // marker without a price (fee waived/zeroed) → nothing to bill
    expect(isBillableLesson(mk({ status: "cancelled", is_cancellation_fee: true, student_price: 0 }), NOW)).toBe(false);
    // ordinary cancellation keeps its snapshot price but has NO marker → must NOT bill
    expect(isBillableLesson(mk({ status: "cancelled", is_cancellation_fee: false, student_price: 500 }), NOW)).toBe(false);
    expect(isBillableLesson(mk({ status: "cancelled", is_cancellation_fee: null, student_price: 500 }), NOW)).toBe(false);
  });
  it("always includes completed lessons", () => {
    expect(isBillableLesson(mk({ status: "completed", starts_at: "2099-01-01T00:00:00Z" }), NOW)).toBe(true);
  });
  it("includes past scheduled lessons and pre-paid future ones only", () => {
    expect(isBillableLesson(mk({ status: "scheduled", starts_at: "2026-06-30T10:00:00Z", student_payment_status: "unpaid", tutor_payout_status: "unpaid" }), NOW)).toBe(true);
    expect(isBillableLesson(mk({ status: "scheduled", starts_at: "2026-07-02T10:00:00Z", student_payment_status: "unpaid", tutor_payout_status: "unpaid" }), NOW)).toBe(false);
    expect(isBillableLesson(mk({ status: "scheduled", starts_at: "2026-07-02T10:00:00Z", student_payment_status: "paid" }), NOW)).toBe(true);
    expect(isBillableLesson(mk({ status: "scheduled", starts_at: "2026-07-02T10:00:00Z", student_payment_status: "unpaid", tutor_payout_status: "paid" }), NOW)).toBe(true);
  });
});

describe("MON-2 money math: profit = Σ paid student_price − Σ paid tutor_payout", () => {
  const rows: MoneyLesson[] = [
    mk({}), // +500 income, +300 expense
    mk({ student_payment_status: "unpaid", tutor_payout_status: "paid" }), // expense only
    mk({ student_payment_status: "paid", tutor_payout_status: "unpaid", student_price: 700 }), // income only
    mk({ student_payment_status: "unpaid", tutor_payout_status: "unpaid", student_price: 400, tutor_payout: 250 }),
    mk({ student_price: null, tutor_payout: null }), // null money is 0, not NaN
  ];
  it("computes paid income / expense / profit", () => {
    expect(paidIncome(rows)).toBe(500 + 700 + 0);
    expect(paidExpense(rows)).toBe(300 + 300 + 0);
    expect(paidProfit(rows)).toBe(1200 - 600);
  });
  it("computes pending sides", () => {
    expect(unpaidIncome(rows)).toBe(500 + 400);
    expect(unpaidExpense(rows)).toBe(700 * 0 + 300 * 0 + 250 + 300); // rows 2 and 3 unpaid payouts
  });
  it("coerces string money (PostgREST numerics arrive as strings)", () => {
    expect(paidIncome([mk({ student_price: "123.5" as any })])).toBe(123.5);
  });
});

describe("grossMarkupPct", () => {
  it("uses only rows with both sides > 0 and returns a percentage", () => {
    const rows = [
      mk({ student_price: 1000, tutor_payout: 600 }),
      mk({ student_price: 500, tutor_payout: 0 }), // ignored (no payout side)
    ];
    expect(grossMarkupPct(rows)).toBeCloseTo(40);
  });
  it("returns null when not computable", () => {
    expect(grossMarkupPct([])).toBeNull();
    expect(grossMarkupPct([mk({ student_price: 0, tutor_payout: 0 })])).toBeNull();
  });
});

describe("sumByCurrency (multi-currency totals for independent tutors)", () => {
  const rows = [
    { amount: 500, cur: "UAH" },
    { amount: 40, cur: "EUR" },
    { amount: 700, cur: "UAH" },
    { amount: 0, cur: "USD" },
    { amount: 10, cur: null as string | null },
  ];
  it("groups by currency, dominant first, dropping zero buckets and defaulting null to UAH", () => {
    expect(sumByCurrency(rows, (r) => r.amount, (r) => r.cur)).toEqual([
      ["UAH", 1210],
      ["EUR", 40],
    ]);
  });
  it("returns [] for no priced rows", () => {
    expect(sumByCurrency([], (r: { amount: number }) => r.amount, () => "UAH")).toEqual([]);
  });
});
