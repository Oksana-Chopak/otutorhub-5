/** 04.09: борг = проведений і не оплачений; заплановані — очікувані платежі. TS і SQL разом. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isStudentDebtLesson, isExpectedPaymentLesson } from "@/lib/financials";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const base = { starts_at: "2099-01-01T10:00:00Z", student_price: 500, tutor_payout: 300, student_payment_status: "unpaid", tutor_payout_status: "unpaid" };
describe("борг vs очікуваний платіж", () => {
  it("запланований неоплачений = очікуваний, НЕ борг", () => {
    expect(isStudentDebtLesson({ ...base, status: "scheduled" })).toBe(false);
    expect(isExpectedPaymentLesson({ ...base, status: "scheduled" })).toBe(true);
  });
  it("проведений неоплачений = борг, не очікуваний", () => {
    expect(isStudentDebtLesson({ ...base, status: "completed" })).toBe(true);
    expect(isExpectedPaymentLesson({ ...base, status: "completed" })).toBe(false);
  });
  it("одна й та сама сума ніколи не в обох цифрах", () => {
    for (const status of ["scheduled", "completed", "cancelled", "pending"]) {
      const l = { ...base, status, is_cancellation_fee: status === "cancelled" };
      expect(isStudentDebtLesson(l) && isExpectedPaymentLesson(l)).toBe(false);
    }
  });
  it("SQL-дзеркало: обидві хабові функції боргу не знають 'scheduled'", () => {
    const sql = readFileSync(join(root, "supabase/migrations/20260904100000_debt_conducted_only_and_topup_date.sql"), "utf8");
    for (const fn of ["manager_debts_summary", "manager_debts_by_currency"]) {
      const body = sql.split(`FUNCTION public.${fn}(`)[1].split("$$;")[0];
      expect(body.split("pay AS")[0], fn).not.toMatch(/'scheduled'/);
    }
  });
  it("wallet_topup приймає _paid_at і не пускає майбутнє", () => {
    const sql = readFileSync(join(root, "supabase/migrations/20260904100000_debt_conducted_only_and_topup_date.sql"), "utf8");
    expect(sql).toMatch(/_paid_at timestamptz DEFAULT NULL/);
    expect(sql).toMatch(/COALESCE\(_paid_at, now\(\)\)/);
    expect(sql).toMatch(/paid_at cannot be in the future/);
  });
});
