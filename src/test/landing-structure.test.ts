/**
 * Лендінг після переродження (10.09): рішення власниці, які не мають тихо
 * відкотитись наступною правкою.
 *  - результат калькулятора — дайджест (імена, час), а не таблиця цифр;
 *  - кнопка під ним — перша дія в продукті, а не «зареєструйся»;
 *  - «один день з помічником» замість сітки з десяти іконок;
 *  - учні мають свою сторінку /for-students; на головній — лише смужка й футер,
 *    жодного блоку «ви учень?» посеред розмови з репетитором;
 *  - копія калькулятора — на «ви», без жіночих форм («ти отримала»).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const landing = src("src/pages/LandingPage.tsx");
const calc = src("src/components/landing/MoneyCalculator.tsx");
const uk = src("src/i18n/locales/uk.ts");

describe("лендінг · переродження 10.09", () => {
  it("калькулятор показує дайджест з іменами й часом і кличе до першої дії", () => {
    expect(calc).toMatch(/digestPreview\(rows\)/);
    expect(calc).toMatch(/landingCalc\.digestDay/);
    expect(calc).toMatch(/landingCalc\.ctaRemind/);
    expect(calc).toMatch(/landingCalc\.ctaDaily/);
    expect(calc).not.toMatch(/landingCalc\.cta"/);
  });
  it("«один день» замість сітки з десяти іконок; секція лишає id=features для навігації", () => {
    expect(landing).toMatch(/<LandingDayStory/);
    expect(landing).not.toMatch(/assistant-grid fade-up/);
    expect(src("src/components/landing/LandingDayStory.tsx")).toMatch(/id="features"/);
  });
  it("учні — на своїй сторінці: маршрут є, на головній лише смужка й футер", () => {
    expect(src("src/App.tsx")).toMatch(/path="\/for-students"/);
    expect(landing).not.toMatch(/LandingFindTutorQuizDialog/);
    expect(landing).not.toMatch(/onFindClick=/);
    expect(landing).toMatch(/to="\/for-students" className="students-strip-link"/);
    expect(landing).toMatch(/landing\.footer\.forStudents/);
    expect(src("src/pages/ForStudentsPage.tsx")).toMatch(/<LandingFindTutorQuizDialog/);
  });
  it("копія калькулятора — на «ви», без жіночих форм", () => {
    const i = uk.indexOf("  landingCalc: {");
    const block = uk.slice(i, uk.indexOf("\n  },\n", i));
    expect(block).not.toMatch(/\bти\b|\bТи\b|отримала|винна\b|сама\b/);
  });
});
