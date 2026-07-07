import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CONTRACT: every page that renders lesson PAYMENT state (LessonCard pay rows,
 * finances rows, dashboard counters) must FETCH the payment-status columns
 * alongside the prices in its lessons_visible select.
 *
 * Why this test exists: SchedulePage selected student_price/tutor_payout but
 * NOT the *_status columns — every card rendered «Очікує» from undefined while
 * Finances showed the truth (owner: «повний хаос із оплатами», 2026-07-07).
 * TypeScript cannot check the contents of a PostgREST select string, so this
 * source-level contract is the tripwire: if a select carries lesson money, it
 * must carry the money's status too.
 */
const PAGES = ["SchedulePage.tsx", "DashboardPage.tsx", "FinancesPage.tsx"];

const read = (f: string) => readFileSync(resolve(__dirname, "../pages", f), "utf-8");

// Every .select("...") string literal in the file.
const selectLiterals = (src: string): string[] =>
  Array.from(src.matchAll(/\.select\(\s*"([^"]+)"/g)).map((m) => m[1]);

describe("money-columns contract: price never travels without its status", () => {
  for (const page of PAGES) {
    it(`${page}: every lessons select with student_price also fetches student_payment_status`, () => {
      const offenders = selectLiterals(read(page)).filter(
        (sel) =>
          sel.includes("student_price") &&
          sel.includes("starts_at") && // lesson-shaped selects only (not rates/details maps)
          !sel.includes("student_payment_status")
      );
      expect(offenders).toEqual([]);
    });

    it(`${page}: every lessons select with tutor_payout also fetches tutor_payout_status`, () => {
      const offenders = selectLiterals(read(page)).filter(
        (sel) =>
          sel.includes("tutor_payout") &&
          !sel.includes("tutor_payout_status") &&
          sel.includes("starts_at")
      );
      expect(offenders).toEqual([]);
    });
  }
});
