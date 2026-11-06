/**
 * «Не прочитав» ≠ «нічого немає» — тепер і на «Мому дні» (06.11).
 *
 * Дашборд читає гроші двома запитами зі стелею. Якщо в неї впертися, борг на
 * екрані менший за справжній — і раніше екран про це мовчав, а при порожньому
 * залишку ще й святкував «Усі оплачені ☀️». Власниця ловила саме це:
 * «у базі 850 ₴, у застосунку 500 ₴».
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { moneyReadIsPartial, DASHBOARD_MONEY_CAP, DASHBOARD_OLD_DEBT_CAP } from "@/lib/financials";

const page = readFileSync("src/pages/DashboardPage.tsx", "utf8");

describe("неповне читання грошей", () => {
  it("впертися у стелю = читання неповне", () => {
    expect(moneyReadIsPartial({ money: DASHBOARD_MONEY_CAP, oldDebts: 0 })).toBe(true);
    expect(moneyReadIsPartial({ money: 0, oldDebts: DASHBOARD_OLD_DEBT_CAP })).toBe(true);
    expect(moneyReadIsPartial({ money: DASHBOARD_MONEY_CAP + 50, oldDebts: 0 }), "більше за стелю — тим паче").toBe(true);
  });

  it("не впертися = читання повне, зайвих тривог немає", () => {
    expect(moneyReadIsPartial({ money: DASHBOARD_MONEY_CAP - 1, oldDebts: DASHBOARD_OLD_DEBT_CAP - 1 })).toBe(false);
    expect(moneyReadIsPartial({ money: 0, oldDebts: 0 }), "порожньо — це теж повна правда").toBe(false);
  });

  it("стеля в запиті і стеля в перевірці — одне число", () => {
    expect(page).toMatch(/\.limit\(DASHBOARD_MONEY_CAP\)/);
    expect(page).toMatch(/\.limit\(DASHBOARD_OLD_DEBT_CAP\)/);
    expect(page, "рішення рахує спільний предикат, а не копія умови").toMatch(/moneyReadIsPartial\(\{/);
    expect(page, "своїх чисел сторінка не тримає").not.toMatch(/\.limit\(2000\)|\.limit\(500\)\s*;[\s\S]{0,80}neq\("source"/);
  });

  it("при неповному читанні «Усі оплачені ☀️» не показується НІКОЛИ", () => {
    expect(page).toMatch(/pendingPayments\.length === 0 && debtors\.length === 0 && !debtPartial \?/);
  });

  it("і людина бачить це словами, з дорогою у «Фінанси»", () => {
    expect(page).toMatch(/debtPartial && \(/);
    expect(page).toMatch(/t\("dashboard\.debtPartial"\)/);
    for (const loc of ["uk", "en", "sv"]) {
      expect(readFileSync(`src/i18n/locales/${loc}.ts`, "utf8"), `${loc}: текст є`).toMatch(/debtPartial: "/);
    }
  });
});
