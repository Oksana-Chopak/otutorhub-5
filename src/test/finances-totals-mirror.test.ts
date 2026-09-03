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
/* Аудит 03.09: фільтр по імені файла не бачив ані копію, яку створює Lovable
   при застосуванні, ані пізнішу міграцію, що перевипускає функцію. Беремо
   ОСТАННІЙ за таймстемпом файл, у якому функція взагалі оголошена. */
const sqlFile = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(join(migDir, f), "utf8").includes("FUNCTION public.finances_period_totals"))
  .sort().at(-1)!;
const sql = readFileSync(join(migDir, sqlFile), "utf8");
const viewFile = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(join(migDir, f), "utf8").includes("CREATE VIEW public.lessons_visible"))
  .sort().at(-1)!;
const viewSql = readFileSync(join(migDir, viewFile), "utf8");

/* Негативні перевірки мусять дивитись на КОД, а не на коментарі: у коментарі
   міграції цитується стара помилкова конструкція — саме щоб її було видно. */
const stripSqlComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*--.*$/gm, " ");
const sqlCode = stripSqlComments(sql);
const viewCode = stripSqlComments(viewSql);
const ts = readFileSync(join(root, "src/lib/financials.ts"), "utf8");
const page = readFileSync(join(root, "src/pages/FinancesPage.tsx"), "utf8");

describe("finances_period_totals дзеркалить financials.ts", () => {
  it("SQL читає lessons_visible як SECURITY INVOKER (маскування успадковане, не переписане)", () => {
    expect(sqlCode).toMatch(/SECURITY INVOKER/);
    expect(sqlCode).toMatch(/FROM public\.lessons_visible/);
    expect(sqlCode).not.toMatch(/SECURITY DEFINER/);
  });

  /* ⛔ Аудит 03.09: функція читала БАЗОВУ lesson_participants, де грошові
     колонки відкликані у authenticated (20260720000000) — тобто падала з
     42501 у кожного, а клієнтський фолбек мовчки повертав підрахунок із 500
     обрізаних рядків. Гроші мусять читатися з маскованого в'ю. */
  it("групові гроші — з lesson_participants_visible, а не з базової таблиці", () => {
    expect(sqlCode).toMatch(/FROM public\.lesson_participants_visible/);
    /* Точна умова: грошові колонки не читаються з БАЗОВОЇ таблиці. Сама
       lessons_visible приєднує lesson_participants заради валюти — це
       дозволено, currency в GRANT є. */
    expect(sqlCode).not.toMatch(/lp\.student_price/);
    expect(sqlCode).not.toMatch(/lp\.student_payment_status/);
  });

  /* ⛔ Аудит 03.09: LEFT JOIN student_rates по (tutor_id, student_id) множив
     КОЖЕН урок на кількість предметів пари — унікальність там по
     (tutor_id, student_id, subject). Дохід і борг подвоювались. */
  it("lessons_visible бере ставку рівно однією (LATERAL … LIMIT 1)", () => {
    expect(viewCode).toMatch(/LEFT JOIN LATERAL/);
    expect(viewCode).toMatch(/FROM public\.student_rates r/);
    expect(viewCode).toMatch(/LIMIT 1/);
    expect(viewCode).not.toMatch(/LEFT JOIN public\.student_rates sr\s*\n\s*ON /);
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
