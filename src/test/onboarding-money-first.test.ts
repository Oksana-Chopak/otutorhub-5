/**
 * Перша сесія має закінчуватись ЧИСЛОМ, а не словами «профіль заповнено».
 *
 * Причина не косметична. Без грошового кроку фінанси нового репетитора
 * порожні, поки не мине місяць: цінність приходить ПІЗНО, а рішення платити
 * треба ухвалити РАНО — тріал один місяць. Репетитор носить суму боргів у
 * голові вже сьогодні, тож ми питаємо про неї в онбордингу і показуємо
 * підсумок грошима.
 *
 * Бази в тестах немає, тож це tripwire на структуру: якщо хтось приберe
 * грошовий крок або поверне фінал до «профіль заповнено», тест скаже де.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_STEPS, CORE } from "@/lib/onboardingSteps";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const flow = readFileSync(join(root, "src/components/OnboardingFlowB.tsx"), "utf8");
const uk = readFileSync(join(root, "src/i18n/locales/uk.ts"), "utf8");

describe("онбординг закінчується грошима", () => {
  it("крок «гроші» існує і він ОБОВʼЯЗКОВИЙ, а не бонусний", () => {
    const debt = ALL_STEPS.find((s) => s.action === "debt");
    expect(debt, "крок debt зник із ALL_STEPS").toBeDefined();
    expect(debt!.group).not.toBe("bonus");
    expect(CORE.some((s) => s.action === "debt")).toBe(true);
  });

  it("крок стоїть ДО налаштувань — одразу після першого уроку", () => {
    const order = CORE.map((s) => s.action);
    expect(order.indexOf("debt")).toBeGreaterThan(order.indexOf("lesson"));
    expect(order.indexOf("debt")).toBeLessThan(order.indexOf("proRules"));
  });

  it("хабовому крок не показується: розрахунки з учнями веде школа", () => {
    expect(flow).toMatch(/HUB_SKIP = new Set\(\[[^\]]*"debt"/);
  });

  it("фінальний екран веде сумою і дає рівно одну дію", () => {
    expect(flow).toMatch(/money\.debt > 0/);
    expect(flow).toMatch(/moneyDebtLabel/);
    expect(flow).toMatch(/formatPrice\(money\.debt, "UAH"\)/);
    expect(flow).toMatch(/moneyDebtCta/);
    expect(flow).toMatch(/finances\?tab=debts/);
  });

  it("якщо боргів немає — показуємо вартість практики, теж число", () => {
    expect(flow).toMatch(/money\.monthly > 0/);
    expect(flow).toMatch(/moneyPracticeLabel/);
  });

  it("борг записується справжніми проведеними уроками, а не абстрактним числом", () => {
    expect(flow).toMatch(/status: "completed" as const/);
    expect(flow).toMatch(/source: "independent"/);
  });

  it("усі нові ключі є в uk.ts", () => {
    for (const k of ["step.debt.title", "debtQuestion", "debtPreview", "moneyDebtLabel", "moneyPracticeLabel"]) {
      expect(uk, `немає ключа ${k}`).toContain(k);
    }
  });
});
