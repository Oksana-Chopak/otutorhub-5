import { describe, it, expect } from "vitest";
import {
  isBillableLesson,
  isStudentDebtLesson,
  isPayoutDueLesson,
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
  it("synthetic group payout status never bills a FUTURE group lesson", () => {
    // Group rows are flattened with tutor_payout_status="paid" (no payout side
    // exists) — that must not make a future scheduled group lesson billable.
    const futureGroup = mk({ status: "scheduled", starts_at: "2026-07-10T10:00:00Z", is_group: true, student_payment_status: "unpaid", tutor_payout_status: "paid" });
    expect(isBillableLesson(futureGroup, NOW)).toBe(false);
    // ...but a REAL student prepayment on a future group lesson does bill,
    expect(isBillableLesson(mk({ ...futureGroup, student_payment_status: "paid" }), NOW)).toBe(true);
    // ...and past group lessons bill as usual.
    expect(isBillableLesson(mk({ ...futureGroup, starts_at: "2026-06-20T10:00:00Z" }), NOW)).toBe(true);
    // Individual lessons keep the payout-side prepay shortcut.
    expect(isBillableLesson(mk({ status: "scheduled", starts_at: "2026-07-10T10:00:00Z", student_payment_status: "unpaid", tutor_payout_status: "paid" }), NOW)).toBe(true);
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

describe("isStudentDebtLesson (PREPAYMENT model — owner rule 2026-07-06)", () => {
  it("counts unpaid FUTURE lessons as debts (hub students pay before lessons)", () => {
    expect(isStudentDebtLesson(mk({ status: "scheduled", starts_at: "2026-07-10T10:00:00Z", student_payment_status: "unpaid" }))).toBe(true);
  });
  it("counts unpaid past + completed lessons", () => {
    expect(isStudentDebtLesson(mk({ status: "scheduled", starts_at: "2026-06-20T10:00:00Z", student_payment_status: "unpaid" }))).toBe(true);
    expect(isStudentDebtLesson(mk({ status: "completed", student_payment_status: "unpaid" }))).toBe(true);
  });
  it("never counts paid, pending, priceless or NULL-status-paid rows", () => {
    expect(isStudentDebtLesson(mk({ student_payment_status: "paid" }))).toBe(false);
    expect(isStudentDebtLesson(mk({ status: "pending", student_payment_status: "unpaid" }))).toBe(false);
    expect(isStudentDebtLesson(mk({ student_payment_status: "unpaid", student_price: 0 }))).toBe(false);
    expect(isStudentDebtLesson(mk({ student_payment_status: "unpaid", student_price: null }))).toBe(false);
  });
  it("treats a missing payment status as unpaid (no details row yet, priced)", () => {
    expect(isStudentDebtLesson(mk({ status: "scheduled", starts_at: "2026-07-10T10:00:00Z", student_payment_status: null }))).toBe(true);
  });
  it("cancelled lessons owe ONLY with the explicit fee marker", () => {
    expect(isStudentDebtLesson(mk({ status: "cancelled", student_payment_status: "unpaid" }))).toBe(false);
    expect(isStudentDebtLesson(mk({ status: "cancelled", student_payment_status: "unpaid", is_cancellation_fee: true }))).toBe(true);
  });
});

describe("isPayoutDueLesson (payouts = CONDUCTED lessons only, mirrors the RPC)", () => {
  const base = { tutor_payout_status: "unpaid", student_payment_status: "paid" } as const;
  it("owes for completed and already-started lessons", () => {
    expect(isPayoutDueLesson(mk({ ...base, status: "completed" }), NOW)).toBe(true);
    expect(isPayoutDueLesson(mk({ ...base, status: "scheduled", starts_at: "2026-06-30T10:00:00Z" }), NOW)).toBe(true);
  });
  it("a FUTURE lesson never owes payout — even when the student PREPAID it", () => {
    // This exact case caused «виплачено, але 2 уроки не проплачені»: the UI sum
    // included future prepaid lessons that mark_tutor_payouts_paid (correctly) skips.
    expect(isPayoutDueLesson(mk({ ...base, status: "scheduled", starts_at: "2026-07-10T10:00:00Z" }), NOW)).toBe(false);
  });
  it("never owes for cancelled/pending/paid/zero-payout/group rows", () => {
    expect(isPayoutDueLesson(mk({ ...base, status: "cancelled" }), NOW)).toBe(false);
    expect(isPayoutDueLesson(mk({ ...base, status: "pending" }), NOW)).toBe(false);
    expect(isPayoutDueLesson(mk({ ...base, tutor_payout_status: "paid" }), NOW)).toBe(false);
    expect(isPayoutDueLesson(mk({ ...base, tutor_payout: 0 }), NOW)).toBe(false);
    expect(isPayoutDueLesson(mk({ ...base, tutor_payout: null }), NOW)).toBe(false);
    expect(isPayoutDueLesson(mk({ ...base, is_group: true }), NOW)).toBe(false);
  });
  it("NULL payout status counts as unpaid (matches the RPC's COALESCE)", () => {
    expect(isPayoutDueLesson(mk({ ...base, tutor_payout_status: null, status: "completed" }), NOW)).toBe(true);
  });
});


// ─── 100% BRANCH COVERAGE: гілки, які v8 показав непокритими (10.08) ───
import { currencySymbol, formatPrice } from "@/lib/currency";

describe("branch completeness (mutation-ready)", () => {
  it("unpaidExpense: null payout → 0; paid ігнорується", () => {
    expect(unpaidExpense([
      { student_price: 100, student_payment_status: "paid", tutor_payout: null, tutor_payout_status: "unpaid" } as any,
      { student_price: 100, student_payment_status: "paid", tutor_payout: 300, tutor_payout_status: "paid" } as any,
    ])).toBe(0);
  });

  it("grossMarkupPct: порожньо → null; нема пар обох сторін → null; норм-кейс рахує", () => {
    expect(grossMarkupPct([])).toBeNull();
    expect(grossMarkupPct([{ student_price: 0, tutor_payout: 300 } as any])).toBeNull();
    expect(grossMarkupPct([{ student_price: 500, tutor_payout: 300 } as any])).toBe(40);
  });

  it("null-гілки грошових полів у всіх агрегатах", () => {
    const rows = [
      { student_price: null, student_payment_status: "paid", tutor_payout: null, tutor_payout_status: "paid", status: "completed", is_cancellation_fee: true } as any,
      { student_price: null, student_payment_status: "unpaid", tutor_payout: null, tutor_payout_status: "unpaid", status: "completed" } as any,
    ];
    expect(paidIncome(rows)).toBe(0);
    expect(unpaidIncome(rows)).toBe(0);
    expect(paidExpense(rows)).toBe(0);
    expect(unpaidExpense(rows)).toBe(0);
    expect(grossMarkupPct(rows)).toBeNull();
  });

  it("isBillableLesson: скасований білиться ЛИШЕ з fee-маркером і ціною > 0", () => {
    const base = { status: "cancelled", student_payment_status: "unpaid", tutor_payout_status: "unpaid", starts_at: new Date().toISOString() };
    expect(isBillableLesson({ ...base, is_cancellation_fee: true, student_price: 200 } as any)).toBe(true);
    expect(isBillableLesson({ ...base, is_cancellation_fee: false, student_price: 200 } as any)).toBe(false);
    expect(isBillableLesson({ ...base, is_cancellation_fee: true, student_price: 0 } as any)).toBe(false);
  });

  it("currencySymbol: без коду ₴; відомий символ; невідомий — сам код", () => {
    expect(currencySymbol()).toBe("₴");
    expect(currencySymbol(null)).toBe("₴");
    expect(currencySymbol("UAH")).toBe("₴");
    expect(currencySymbol("XYZ")).toBe("XYZ");
  });

  it("formatPrice: null→0; decimals; символ-після; символ-перед; без символа — код; без валюти → ₴", () => {
    expect(formatPrice(5)).toMatch(/₴/);
    expect(formatPrice(null, "UAH")).toMatch(/0/);
    expect(formatPrice(10.5, "UAH", { decimals: 2 })).toContain("10.50");
    expect(formatPrice(5, "UAH")).toMatch(/₴/);
    expect(formatPrice(5, "USD")).toMatch(/^\$/);
    expect(formatPrice(5, "XYZ")).toContain("XYZ");
  });
});
