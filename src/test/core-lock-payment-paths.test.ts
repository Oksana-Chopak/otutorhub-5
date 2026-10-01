/**
 * В3 (аудит 01.10) — ПЛАТНІ ВОРОТА обходились найчастішою дією продукту.
 *
 * Замок 05.09: незалежний репетитор без живого тріалу чи підписки не створює
 * уроків і не позначає оплат. Серверний замок (`trg_00_core_lock`,
 * `20260927190000`) стоїть на INSERT у `lessons` і `student_wallet_transactions`
 * — а позначення оплати це UPDATE `lesson_details`, тобто сервер його НЕ
 * тримає. Отже єдиний замок на цій дії — клієнтський, і він стояв лише в
 * `FinancesPage.togglePayment`. Повз нього писали оплати:
 *   • «Закрити день» (`CloseDayDialog`) — головний щоденний ритуал;
 *   • черга «після уроку» (`AfterLessonSheet`);
 *   • «Позначити всі оплаченими» (`FinancesPage`, кличе `writeStudentPayment`
 *     напряму, мимо `togglePayment`).
 *
 * Тест тримає правило загально: будь-який файл у `src/components` чи
 * `src/pages`, який ПИШЕ оплату учня, мусить питати замок. Нова поверхня з
 * такою дією або перевіряє `coreLock.locked`, або падає тут.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components", "src/pages"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Справжній ЗАПИС оплати, а не оголошення типу (`student_payment_status: "paid" | "unpaid"`). */
const WRITES = [
  /student_payment_status:\s*"paid"\s*,?\s*(?:student_paid_at|\})/,  // в об'єкті-патчі
  /\.student_payment_status\s*=\s*"paid"/,                            // patch.x = "paid"
  /writeStudentPayment\s*\(/,                                         // прямий писар FinancesPage
];

describe("замок ядра: кожен клієнтський запис оплати питає пейвол", () => {
  const files = ROOTS.flatMap(walk);

  it("знаходить саме поверхні запису, а не оголошення типів", () => {
    // Якщо регулярки зламаються, тест нижче стане вакуумним — тримаємо нижню межу.
    const writers = files.filter((f) => {
      const src = stripComments(readFileSync(f, "utf-8"));
      return WRITES.some((re) => re.test(src));
    });
    expect(writers.length, "очікуємо щонайменше чотири відомі поверхні").toBeGreaterThanOrEqual(4);
    // Оголошення типу `student_payment_status: "paid" | "unpaid"` писарем НЕ є.
    expect(writers).not.toContain("src/components/FinanceWeeklyChart.tsx");
  });

  it("жодна з них не пише оплату без перевірки замка", () => {
    const unguarded: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf-8"));
      if (!WRITES.some((re) => re.test(src))) continue;
      // Будь-яка форма питання до замка: `coreLock.locked` / `lock.locked`.
      if (!/\b(?:coreLock|lock)\.locked\b/.test(src)) unguarded.push(f);
    }
    expect(unguarded, `ці файли пишуть оплату повз пейвол:\n${unguarded.join("\n")}`).toEqual([]);
  });

  it("три поверхні, через які замок обходився, тримаються поіменно", () => {
    const close = stripComments(readFileSync("src/components/CloseDayDialog.tsx", "utf-8"));
    expect(close, "«Закрити день» мусить питати замок ДО запису")
      .toMatch(/const apply = async \(\) => \{\s*if \(coreLock\.locked\) \{ coreLock\.openPaywall\(\); return; \}/);
    // Серверна відмова на «повторити наступного тижня» — пропозиція, не код помилки.
    expect(close).toMatch(/isSubscriptionRequiredError\(error\)/);

    const after = stripComments(readFileSync("src/components/AfterLessonSheet.tsx", "utf-8"));
    expect(after, "пейвол у момент наміру, і повторна перевірка перед записом")
      .toMatch(/if \(coreLock\.locked\) \{ coreLock\.openPaywall\(\); return; \}/);
    expect(after).toMatch(/canMarkPaid && !coreLock\.locked && paid/);

    const fin = stripComments(readFileSync("src/pages/FinancesPage.tsx", "utf-8"));
    expect((fin.match(/if \(coreLock\.locked\) \{ coreLock\.openPaywall\(\); return; \}/g) ?? []).length,
      "і togglePayment, і «Позначити всі» — обидва").toBeGreaterThanOrEqual(2);
  });
});
