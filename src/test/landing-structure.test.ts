/**
 * Лендінг після переродження 12.09 — рішення власниці, які не мають тихо
 * відкотитись наступною правкою («одна дія, один вау-флоу, чіткість з
 * першого рядка, позиціонування»):
 *  - одна персона (репетитор), жодної ротації «для консультанта / психолога»;
 *  - герой = поле «хто вам винен» + дайджест + ОДНА кнопка; жодних дублів
 *    («Спробуй прямо зараз», шерна картка, три кнопки під результатом);
 *  - поле читає список у режимі «debts» — «Артем 1500» це борг, а не ціна;
 *  - в естафету їде канонічний текст, який імпорт читає так само;
 *  - учні — на /for-students; на головній лише рядок і футер;
 *  - палітра лендінгу лишається у LandingPage.tsx (її стереже contrast-gate).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const landing = src("src/pages/LandingPage.tsx");
const hero = src("src/components/landing/LandingHero.tsx");
const uk = src("src/i18n/locales/uk.ts");

describe("лендінг · переродження 12.09", () => {
  it("одна персона — репетитор; ротації персон і пілюль немає", () => {
    expect(landing).not.toMatch(/PERSONA_IDS|persona-pill|setActiveIndex|isAnimating/);
    expect(landing).toMatch(/landing\.personas\.tutor/);
    expect(landing).toMatch(/personaId="tutor"/);
  });
  it("герой — один потік: поле → дайджест → одна кнопка; дублі прибрано", () => {
    expect(landing).toMatch(/<LandingHero signupHref=\{signupHref\} \/>/);
    expect(landing).not.toMatch(/MoneyCalculator|LandingTryDemo|LandingLiveStats|shareCard|chat-bubble/);
    expect(existsSync(join(root, "src/components/landing/MoneyCalculator.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/lib/shareCard.ts"))).toBe(false);
    // рівно одна первинна кнопка в герої і одна у фінальному блоці
    expect(hero.match(/className="btn-primary btn-big"/g)).toHaveLength(1);
    expect(landing.match(/className="btn-white"/g)).toHaveLength(1);
    expect(hero).not.toMatch(/landingShare|shareCard/);
  });
  it("поле читає список у режимі «debts», естафета отримує канонічний текст", () => {
    expect(hero).toMatch(/parseStudentList\(source, \{ mode: "debts" \}\)/);
    expect(hero).toMatch(/toCanonicalText\(rows, kw\)/);
    expect(hero).toMatch(/saveLandingDraft\(canonical\)/);
    expect(hero).toMatch(/_list: canonical/);
  });
  it("порожнє поле показує дайджест із прикладу, а не порожній екран", () => {
    expect(hero).toMatch(/const source = isExample \? sample : text/);
    expect(hero).toMatch(/landingHero\.exampleTag/);
    expect(hero).toMatch(/landingHero\.tryExample/);
  });
  it("Telegram: після await посилання рендериться явно, мобілка — перехід у тій самій вкладці", () => {
    expect(hero).toMatch(/window\.location\.assign\(url\)/);
    expect(hero).toMatch(/<a href=\{tgLink\}/);
  });
  it("учні — на своїй сторінці; на головній лише рядок і футер", () => {
    expect(src("src/App.tsx")).toMatch(/path="\/for-students"/);
    expect(landing).not.toMatch(/LandingFindTutorQuizDialog/);
    expect(landing).toMatch(/to="\/for-students" className="students-strip-link"/);
    expect(landing).toMatch(/landing\.footer\.forStudents/);
  });
  it("копія героя — на «ви», позиціонування в першому рядку", () => {
    const i = uk.indexOf("  landingHero: {");
    const block = uk.slice(i, uk.indexOf("\n  },\n", i));
    expect(block).toMatch(/title: "Учні платять вчасно/);
    expect(block).toMatch(/eyebrow: "Помічник репетитора"/);
    expect(block).not.toMatch(/\bти\b|\bТи\b|отримала|винна\b|сама\b/);
  });
  it("шрифти лендінгу не дрібні: базовий ≥ 17px, поле ≥ 17px, кнопка ≥ 56px", () => {
    expect(landing).toMatch(/\.landing-root \{[^}]*font-size: 18px/);
    expect(landing).toMatch(/\.paste-field \{[^}]*17px/);
    expect(landing).toMatch(/\.btn-primary \{[^}]*min-height: 56px/);
  });
});
