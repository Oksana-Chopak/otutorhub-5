import { describe, it, expect, vi } from "vitest";

/**
 * Тести, написані ЗА мутантами (Stryker, 27.09): кожен блок убиває мутацію, яка
 * вижила на грошових бібліотеках — тобто зміну коду, якої жоден тест не помічав.
 * currency.ts мав 46 живих мутантів (символи валют, порядок «сума символ»),
 * financials.ts — 17 (межі «ціна > 0», «майбутній/минулий», «скасований/чернетка»).
 * Гроші на екрані — те, чому клієнт вірить або ні; тут кожна межа названа явно.
 */

vi.mock("@/lib/locale", () => ({ getLocale: () => "en-US" }));

import { currencySymbol, formatPrice, CURRENCY_OPTIONS } from "@/lib/currency";
import {
  isBillableLesson, isExpectedPaymentLesson, isPayoutDueLesson, grossMarkupPct, sumByCurrency,
  type MoneyLesson,
} from "@/lib/financials";

describe("currency: символ і його місце", () => {
  it("символи всіх валют з переліку — точні", () => {
    const expected: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", SEK: "kr", PLN: "zł", GBP: "£" };
    for (const [code, sym] of Object.entries(expected)) {
      expect(currencySymbol(code), code).toBe(sym);
      const opt = CURRENCY_OPTIONS.find((o) => o.code === code)!;
      expect(opt.symbol, `option ${code}`).toBe(sym);
      expect(opt.label, `label ${code}`).toBe(`${sym} ${code}`);
    }
    expect(currencySymbol("CZK")).toBe("Kč");
    expect(currencySymbol("CHF")).toBe("₣");
    expect(currencySymbol("NOK")).toBe("kr");
    expect(currencySymbol("DKK")).toBe("kr");
    expect(currencySymbol("HUF")).toBe("Ft");
    expect(currencySymbol("RON")).toBe("lei");
  });

  it("без валюти — гривня; невідомий код повертається як є", () => {
    expect(currencySymbol(null)).toBe("₴");
    expect(currencySymbol(undefined)).toBe("₴");
    expect(currencySymbol("")).toBe("₴");
    expect(currencySymbol("XYZ")).toBe("XYZ");
  });

  it("гривня, злотий, крони — символ ПІСЛЯ суми; долар, євро, фунт — ПЕРЕД", () => {
    expect(formatPrice(500, "UAH")).toBe("500 ₴");
    expect(formatPrice(500, "PLN")).toBe("500 zł");
    expect(formatPrice(500, "SEK")).toBe("500 kr");
    expect(formatPrice(500, "NOK")).toBe("500 kr");
    expect(formatPrice(500, "CZK")).toBe("500 Kč");
    expect(formatPrice(500, "HUF")).toBe("500 Ft");
    expect(formatPrice(500, "USD")).toBe("$500");
    expect(formatPrice(500, "EUR")).toBe("€500");
    expect(formatPrice(500, "GBP")).toBe("£500");
    expect(formatPrice(500, "CHF")).toBe("₣500");
  });

  it("невідома валюта — сума і код через пробіл", () => {
    expect(formatPrice(500, "XYZ")).toBe("500 XYZ");
  });

  it("порожня сума = 0, порожня валюта = гривня, дробові — до двох знаків", () => {
    expect(formatPrice(null)).toBe("0 ₴");
    expect(formatPrice(undefined, null)).toBe("0 ₴");
    expect(formatPrice("350", undefined)).toBe("350 ₴");
    expect(formatPrice(12.5, "USD")).toBe("$12.5");
    expect(formatPrice(12.345, "USD")).toBe("$12.35");
    expect(formatPrice(1234, "UAH")).toBe("1,234 ₴");
  });

  it("decimals задає рівно стільки знаків", () => {
    expect(formatPrice(1234, "SEK", { decimals: 2 })).toBe("1234.00 kr");
    expect(formatPrice(12.345, "USD", { decimals: 1 })).toBe("$12.3");
    expect(formatPrice(5, "UAH", { decimals: 0 })).toBe("5 ₴");
  });
});

const NOW = Date.parse("2026-09-27T12:00:00Z");
const past = "2026-09-26T12:00:00Z";
const future = "2026-09-28T12:00:00Z";
const base: MoneyLesson = { status: "scheduled", starts_at: past, student_price: 500, tutor_payout: 350 } as MoneyLesson;

describe("financials: межі, які ловили мутанти", () => {
  it("isBillableLesson: чернетка — ніколи; проведений — завжди; майбутній — лише з оплатою", () => {
    expect(isBillableLesson({ ...base, status: "pending" }, NOW)).toBe(false);
    expect(isBillableLesson({ ...base, status: "pending", student_payment_status: "paid" }, NOW)).toBe(false);
    expect(isBillableLesson({ ...base, status: "completed", starts_at: future }, NOW)).toBe(true);
    expect(isBillableLesson({ ...base, starts_at: future }, NOW)).toBe(false);
    expect(isBillableLesson({ ...base, starts_at: future, student_payment_status: "paid" }, NOW)).toBe(true);
    expect(isBillableLesson({ ...base, starts_at: past }, NOW)).toBe(true);
  });

  it("isExpectedPaymentLesson: лише неоплачений, з ціною > 0, запланований у майбутньому", () => {
    expect(isExpectedPaymentLesson({ ...base, starts_at: future }, NOW)).toBe(true);
    expect(isExpectedPaymentLesson({ ...base, starts_at: future, student_price: 0 }, NOW)).toBe(false);
    expect(isExpectedPaymentLesson({ ...base, starts_at: future, student_price: -1 }, NOW)).toBe(false);
    expect(isExpectedPaymentLesson({ ...base, starts_at: future, student_payment_status: "paid" }, NOW)).toBe(false);
    expect(isExpectedPaymentLesson({ ...base, starts_at: past }, NOW)).toBe(false);
    expect(isExpectedPaymentLesson({ ...base, starts_at: future, status: "completed" }, NOW)).toBe(false);
    expect(isExpectedPaymentLesson({ ...base, starts_at: future, status: "pending" }, NOW)).toBe(false);
    // рівно «зараз» — ще не майбутнє
    expect(isExpectedPaymentLesson({ ...base, starts_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it("isPayoutDueLesson: виплата > 0, не скасований/чернетка, проведений або вже минулий", () => {
    expect(isPayoutDueLesson({ ...base, starts_at: past }, NOW)).toBe(true);
    expect(isPayoutDueLesson({ ...base, starts_at: new Date(NOW).toISOString() }, NOW)).toBe(true);
    expect(isPayoutDueLesson({ ...base, starts_at: future }, NOW)).toBe(false);
    expect(isPayoutDueLesson({ ...base, starts_at: future, status: "completed" }, NOW)).toBe(true);
    expect(isPayoutDueLesson({ ...base, tutor_payout: 0 }, NOW)).toBe(false);
    expect(isPayoutDueLesson({ ...base, tutor_payout: -5 }, NOW)).toBe(false);
    expect(isPayoutDueLesson({ ...base, status: "cancelled" }, NOW)).toBe(false);
    expect(isPayoutDueLesson({ ...base, status: "pending" }, NOW)).toBe(false);
    expect(isPayoutDueLesson({ ...base, tutor_payout_status: "paid" }, NOW)).toBe(false);
    expect(isPayoutDueLesson({ ...base, is_group: true }, NOW)).toBe(false);
  });

  it("grossMarkupPct: рахує лише рядки з обома сторонами > 0", () => {
    expect(grossMarkupPct([])).toBeNull();
    expect(grossMarkupPct([{ ...base, student_price: 0 }])).toBeNull();
    expect(grossMarkupPct([{ ...base, tutor_payout: 0 }])).toBeNull();
    expect(grossMarkupPct([{ ...base, student_price: 500, tutor_payout: 350 }])).toBeCloseTo(30, 6);
    // рядок без виплати не тягне маржу до 100 %
    expect(grossMarkupPct([{ ...base, student_price: 500, tutor_payout: 350 }, { ...base, student_price: 1000, tutor_payout: 0 }])).toBeCloseTo(30, 6);
  });

  it("sumByCurrency: нулі пропускає, валюта за замовчуванням — гривня, сортує за модулем спадно", () => {
    const rows = [
      { a: 100, c: "UAH" }, { a: 0, c: "USD" }, { a: -700, c: "SEK" }, { a: 250, c: null }, { a: 40, c: "EUR" },
    ];
    expect(sumByCurrency(rows, (r) => r.a, (r) => r.c)).toEqual([["SEK", -700], ["UAH", 350], ["EUR", 40]]);
  });
});

import { isPrepaidAheadLesson, countLessonsMissingPrice, isStudentDebtLesson } from "@/lib/financials";

describe("financials: функції без жодного тесту (мутанти «no coverage»)", () => {
  it("isPrepaidAheadLesson: запланований, оплачений, з ціною, у майбутньому — і лише так", () => {
    const paidFuture = { ...base, starts_at: future, student_payment_status: "paid" } as MoneyLesson;
    expect(isPrepaidAheadLesson(paidFuture, NOW)).toBe(true);
    expect(isPrepaidAheadLesson({ ...paidFuture, status: "completed" }, NOW)).toBe(false);
    expect(isPrepaidAheadLesson({ ...paidFuture, status: "cancelled" }, NOW)).toBe(false);
    expect(isPrepaidAheadLesson({ ...paidFuture, student_payment_status: "unpaid" }, NOW)).toBe(false);
    expect(isPrepaidAheadLesson({ ...paidFuture, student_price: 0 }, NOW)).toBe(false);
    expect(isPrepaidAheadLesson({ ...paidFuture, starts_at: past }, NOW)).toBe(false);
    expect(isPrepaidAheadLesson({ ...paidFuture, starts_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it("isStudentDebtLesson: борг = проведений і не оплачений; скасований — лише зі штрафом", () => {
    expect(isStudentDebtLesson({ ...base, status: "completed" })).toBe(true);
    expect(isStudentDebtLesson({ ...base, status: "completed", student_payment_status: "paid" })).toBe(false);
    expect(isStudentDebtLesson({ ...base, status: "completed", student_price: 0 })).toBe(false);
    expect(isStudentDebtLesson({ ...base, status: "scheduled" })).toBe(false);
    expect(isStudentDebtLesson({ ...base, status: "cancelled" })).toBe(false);
    expect(isStudentDebtLesson({ ...base, status: "cancelled", is_cancellation_fee: true })).toBe(true);
  });

  it("countLessonsMissingPrice: лише незалежному; групові не рахуються; для хабового рядка — і виплата", () => {
    const rows = [
      { student_id: "s1", status: "scheduled", student_price: 0, tutor_payout: 0, source: "independent" }, // без ціни → 1
      { student_id: "s2", status: "completed", student_price: 300, tutor_payout: 0, source: "independent" }, // ок для незалежного
      { student_id: "s3", status: "completed", student_price: 300, tutor_payout: 0, source: "hub" }, // хабовий без виплати → 1
      { student_id: null, status: "scheduled", student_price: 0, tutor_payout: 0, source: "independent" }, // груповий → ні
      { student_id: "s5", status: "cancelled", student_price: 0, tutor_payout: 0, source: "independent" }, // скасований → ні
      { student_id: "s6", status: "pending", student_price: 0, tutor_payout: 0, source: "independent" }, // чернетка → ні
    ];
    expect(countLessonsMissingPrice(rows, { isIndependent: true })).toBe(2);
    expect(countLessonsMissingPrice(rows, { isIndependent: false })).toBe(0);
  });
});
