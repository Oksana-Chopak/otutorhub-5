/**
 * M2: finances_period_totals (SQL) мусить ДОСЛІВНО дзеркалити isBillableLesson,
 * paidIncome, paidExpense, grossMarkupPct із src/lib/financials.ts.
 *
 * Бази в тестах нема, тому це tripwire на ТЕКСТ: кожне правило з TS має свій
 * незамінний відбиток у SQL. Хтось змінить одну сторону — тест упаде і скаже,
 * яку саме. Разом із клієнтським паритетом (dbTotals vs масив без обрізання)
 * це дві незалежні сітки під одним числом.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migDir = join(root, "supabase/migrations");
const sqlFile = readdirSync(migDir).filter((f) => f.includes("finances_period_totals")).sort().at(-1)!;
const sql = readFileSync(join(migDir, sqlFile), "utf8");
const ts = readFileSync(join(root, "src/lib/financials.ts"), "utf8");
const page = readFileSync(join(root, "src/pages/FinancesPage.tsx"), "utf8");

describe("finances_period_totals дзеркалить financials.ts", () => {
  it("SQL читає lessons_visible як SECURITY INVOKER (маскування успадковане, не переписане)", () => {
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(sql).toMatch(/FROM public\.lessons_visible/);
    expect(sql).not.toMatch(/SECURITY DEFINER/);
  });

  it("isBillableLesson: cancelled → лише з is_cancellation_fee і price>0", () => {
    expect(ts).toMatch(/is_cancellation_fee === true && Number\(l\.student_price \?\? 0\) > 0/);
    expect(sql).toMatch(/status = 'cancelled' THEN r\.is_cancellation_fee IS TRUE AND coalesce\(r\.student_price,0\) > 0/);
  });

  it("isBillableLesson: pending → ніколи; completed → завжди", () => {
    expect(ts).toMatch(/status === "pending"\) return false/);
    expect(ts).toMatch(/status === "completed"\) return true/);
    expect(sql).toMatch(/status = 'pending'\s+THEN false/);
    expect(sql).toMatch(/status = 'completed' THEN true/);
  });

  it("isBillableLesson: інакше — минулий АБО оплата; tutor_payout_status рахується лише для НЕгрупових", () => {
    expect(ts).toMatch(/l\.student_payment_status === "paid" \|\| \(!l\.is_group && l\.tutor_payout_status === "paid"\)/);
    expect(sql).toMatch(/r\.starts_at < now\(\)/);
    expect(sql).toMatch(/r\.student_payment_status = 'paid'/);
    expect(sql).toMatch(/NOT r\.is_group AND r\.tutor_payout_status = 'paid'/);
  });

  it("paidIncome / paidExpense: ті самі фільтри; витрати — не групи", () => {
    expect(ts).toMatch(/filter\(\(l\) => l\.student_payment_status === "paid"\)/);
    expect(ts).toMatch(/filter\(\(l\) => l\.tutor_payout_status === "paid"\)/);
    expect(sql).toMatch(/sum\(student_price\) FILTER \(WHERE student_payment_status = 'paid'\)/);
    expect(sql).toMatch(/sum\(tutor_payout\)\s+FILTER \(WHERE NOT is_group AND tutor_payout_status = 'paid'\)/);
  });

  it("grossMarkupPct: лише рядки з price>0 AND payout>0 — в обох", () => {
    expect(ts).toMatch(/Number\(l\.student_price \?\? 0\) > 0 && Number\(l\.tutor_payout \?\? 0\) > 0/);
    expect(sql).toMatch(/coalesce\(student_price,0\) > 0 AND coalesce\(tutor_payout,0\) > 0/);
  });

  it("клієнт: RPC-число використовується з фолбеком, а розбіжність із масивом ПОКАЗУЄТЬСЯ", () => {
    expect(page).toMatch(/finances_period_totals/);
    expect(page).toMatch(/dbTotals \? dbTotals\.paid_income : arrIncome/);
    expect(page).toMatch(/totalsParity === false/);
    expect(page).toMatch(/finances\.totalsParityMismatch/);
  });
});
