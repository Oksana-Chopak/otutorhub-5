/**
 * 22.09 — аудит «весь застосунок»: PostgREST віддає не більше max_rows рядків
 * (у Supabase типово 1000) БЕЗ помилки. Ранковий дайджест і нагадування про
 * борг читали «усі уроки платформи» одним запитом — усе понад тисячу тихо
 * зникало, а репетитор отримував «✅ Всі оплати закриті».
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../../supabase/functions/_shared/fetchAll";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

/** Сервер, що віддає не більше `cap` рядків за раз, як справжній PostgREST. */
const server = (total: number, cap: number, failAtFrom?: number) => {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    if (failAtFrom !== undefined && from >= failAtFrom) return { data: null, error: { message: "boom" } };
    const n = Math.max(0, Math.min(to - from + 1, cap, total - from));
    return { data: Array.from({ length: n }, (_, i) => from + i), error: null };
  };
  return { page, calls };
};

describe("fetchAllRows: дочитує все, а не першу тисячу", () => {
  it("2 500 рядків при ліміті сервера 1000 → усі 2 500, без дублів", async () => {
    const s = server(2500, 1000);
    const r = await fetchAllRows<number>(s.page);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(2500);
    expect(new Set(r.data).size).toBe(2500);
    expect(r.data[2499]).toBe(2499);
  });

  it("ліміт сервера МЕНШИЙ за сторінку (500 < 1000) → однаково все", async () => {
    const s = server(1800, 500);
    const r = await fetchAllRows<number>(s.page);
    expect(r.data).toHaveLength(1800);
    // рухаємось на реально отримане: 0, 500, 1000, 1500, 1800(порожня)
    expect(s.calls.map((c) => c[0])).toEqual([0, 500, 1000, 1500, 1800]);
  });

  it("рівно 1000 рядків — не зупиняється на повній сторінці, перевіряє наступну", async () => {
    const s = server(1000, 1000);
    const r = await fetchAllRows<number>(s.page);
    expect(r.data).toHaveLength(1000);
    expect(s.calls).toHaveLength(2);
  });

  it("помилка посередині → повертає помилку (викликач не бреше «усе оплачено»)", async () => {
    const s = server(3000, 1000, 1000);
    const r = await fetchAllRows<number>(s.page);
    expect(r.error?.message).toBe("boom");
    expect(r.data).toHaveLength(1000);
  });

  it("запобіжник maxRows не дає зациклитись", async () => {
    const s = server(10_000, 1000);
    const r = await fetchAllRows<number>(s.page, { maxRows: 3000 });
    expect(r.capped).toBe(true);
    expect(r.data.length).toBe(3000);
  });
});

describe("дайджест і нагадування читають сторінками і чесно кажуть про збій", () => {
  const digest = src("supabase/functions/tutor-daily-digest/index.ts");
  const reminders = src("supabase/functions/payment-reminders/index.ts");

  it("дайджест: сьогоднішні уроки, гроші й групові борги — через fetchAllRows зі стабільним порядком", () => {
    expect(digest).toMatch(/from "\.\.\/_shared\/fetchAll\.ts"/);
    for (const name of ["todayRaw", "moneyRaw", "groupRaw"]) {
      expect(digest, name).toMatch(new RegExp(`const \\{ data: ${name}, error: \\w+ \\} = await fetchAllRows<any>\\(`));
    }
    expect((digest.match(/\.order\("id", \{ ascending: true \}\)\s*\n\s*\.range\(a, b\)\)/g) ?? []).length).toBe(3);
  });

  it("дайджест: збій читання грошей — не «✅ Всі оплати закриті», а чесний рядок", () => {
    expect(digest).toMatch(/const moneyFailed = !!\(moneyErr \|\| groupErr\)/);
    const tutor = digest.slice(digest.indexOf("} else if (isTutor) {"));
    const iFailed = tutor.indexOf("} else if (moneyFailed) {");
    const iAllPaid = tutor.indexOf("lines.push(D.allPaid)");
    expect(iFailed).toBeGreaterThan(0);
    expect(iFailed).toBeLessThan(iAllPaid);
    expect(digest).toMatch(/if \(moneyFailed\) lines\.push\(D\.moneyUnavailable\);/);
    for (const t of ["Оплати зараз не вдалося перевірити", "Couldn’t check payments right now", "Kunde inte kontrollera betalningar"]) {
      expect(digest).toContain(t);
    }
  });

  it("дайджест: збій читання розкладу — не «Сьогодні вільний день»", () => {
    expect((digest.match(/if \(todayErr\) \{\s*\n\s*lines\.push\(D\.todayUnavailable\);/g) ?? []).length).toBe(2);
  });

  it("дайджест: хабовий репетитор не отримує «✅ Всі оплати закриті» про гроші школи", () => {
    const tutor = digest.slice(digest.indexOf("} else if (isTutor) {"));
    const iGate = tutor.indexOf("if (!hasIndependent) {");
    const iAllPaid = tutor.indexOf("lines.push(D.allPaid)");
    expect(iGate).toBeGreaterThan(0);
    expect(iGate).toBeLessThan(iAllPaid);
    expect(tutor, "✅ «оплачено» — лише на власних уроках")
      .toMatch(/const paid = l\.source === "independent" && detailOf\(l\)\?\.student_payment_status === "paid"/);
  });

  it("нагадування про борг: індивідуальні й групові — сторінками; збій груп видно в логах", () => {
    expect(reminders).toMatch(/from "\.\.\/_shared\/fetchAll\.ts"/);
    expect(reminders).toMatch(/const \{ data: debtRaw, error: debtErr \} = await fetchAllRows<any>\(/);
    expect(reminders).toMatch(/const \{ data: gDebtRaw, error: gDebtErr \} = await fetchAllRows<any>\(/);
    expect(reminders).toMatch(/if \(gDebtErr\) console\.error\(/);
  });
});
