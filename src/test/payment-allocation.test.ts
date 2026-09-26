import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allocateAmount } from "@/lib/paymentAllocation";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const L = (id: string, day: string, price: number, status = "completed") => ({
  id, starts_at: `2026-09-${day}T10:00:00Z`, student_price: price, status,
});

/**
 * Важіль 5 (аудит шляхів 24.09): гроші вводяться СУМОЮ. Головна вимога — те, що
 * показано («покриває 3 уроки · лишок 0»), мусить дорівнювати тому, що зробить
 * база: `wallet_settle_pair` списує кредит на найстаріші неоплачені уроки і
 * ЗУПИНЯЄТЬСЯ на першому, який не закривається повністю.
 */
describe("розподіл суми по уроках (важіль 5)", () => {
  it("1500 на три уроки по 500 — закриває всі три, лишок 0", () => {
    const r = allocateAmount(1500, [L("a", "12", 500), L("b", "15", 500), L("c", "19", 500)]);
    expect(r.covered.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(r.leftover).toBe(0);
    expect(r.used).toBe(1500);
  });

  it("порядок — від НАЙСТАРІШОГО, як у базі, а не як у списку", () => {
    const r = allocateAmount(500, [L("new", "19", 500), L("old", "12", 500)]);
    expect(r.covered.map((l) => l.id)).toEqual(["old"]);
  });

  it("урок не закривається частково — і цикл ЗУПИНЯЄТЬСЯ (ELSE EXIT у SQL)", () => {
    // 700 не закриває урок на 1000, і НЕ перескакує на дешевший наступний.
    const r = allocateAmount(700, [L("big", "12", 1000), L("small", "15", 300)]);
    expect(r.covered).toEqual([]);
    expect(r.leftover).toBe(700);
  });

  it("лишок лишається на гаманці — це і є передоплата", () => {
    const r = allocateAmount(1200, [L("a", "12", 500), L("b", "15", 500)]);
    expect(r.covered.map((l) => l.id)).toEqual(["a", "b"]);
    expect(r.leftover).toBe(200);
  });

  it("скасовані уроки й нульові ціни в розподіл не входять", () => {
    const r = allocateAmount(1000, [L("cancelled", "12", 500, "cancelled"), L("zero", "13", 0), L("real", "14", 500)]);
    expect(r.covered.map((l) => l.id)).toEqual(["real"]);
    expect(r.leftover).toBe(500);
  });

  it("сміття на вході не ламає нічого", () => {
    expect(allocateAmount(Number.NaN, [L("a", "12", 500)]).covered).toEqual([]);
    expect(allocateAmount(-100, [L("a", "12", 500)]).leftover).toBe(0);
    expect(allocateAmount(500, []).covered).toEqual([]);
  });

  it("це саме ДЗЕРКАЛО SQL: правила збігаються слово в слово", () => {
    // Якщо SQL колись зміниться, цей тест покаже, що клієнт відстав.
    const lib = read("src/lib/paymentAllocation.ts");
    expect(lib).toMatch(/wallet_settle_pair/);
    expect(lib, "порядок за датою").toMatch(/sort\(\(a, b\) => String\(a\.starts_at\)\.localeCompare/);
    expect(lib, "часткове закриття заборонене").toMatch(/break; \/\/ ELSE EXIT/);
  });

  it("форма оплати: сума — ПЕРШЕ поле, і запис іде канонічним wallet_topup", () => {
    const sheet = read("src/components/RecordPaymentSheet.tsx");
    const iIncoming = sheet.indexOf('id="rp-incoming"');
    const iList = sheet.indexOf("recordPaymentExtra.selectedTotal");
    expect(iIncoming).toBeGreaterThan(0);
    expect(iIncoming, "поле суми стоїть ДО списку уроків").toBeLessThan(iList);
    expect(sheet).toMatch(/const alloc = useMemo/);
    expect(sheet, "гроші пишуться лише канонічним поповненням гаманця")
      .toMatch(/submitIncoming[\s\S]{0,600}?rpc\("wallet_topup" as any/);
    expect(sheet, "замок підписки перевіряється й тут").toMatch(/submitIncoming = async \(\) => \{\s*\n\s*if \(lock\.locked\)/);
  });
});
