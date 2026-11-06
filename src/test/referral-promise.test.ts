/**
 * Реферальна програма обіцяє рівно те, що робить (06.11).
 *
 * Обхід системи іншим агентом дав пункт «реферальна програма платить лише за
 * друга з оплатою». Сама поведінка правильна й так задумана — але українські
 * тексти (ГОЛОВНИЙ ринок) обіцяли місяць «за друга», без умови, тоді як
 * англійський і шведський варіанти ту саму умову вже називали. Тобто людина в
 * Україні бачила обіцянку, якої продукт не виконує, — саме те, що правило
 * «не обіцяй, чого не розрізняєш» (14.09) забороняє.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const loc = (l: string) => readFileSync(`src/i18n/locales/${l}.ts`, "utf8");
/**
 * Рядки, що називають нагороду ЗА ДРУГА, мусять називати й УМОВУ.
 *
 * Умова — це ДІЯ друга, а не слово «підписка» в назві нагороди: перша версія
 * цієї перевірки ловила «підпис» усередині «місяць ПІДПИСКИ» і тому лишалась
 * зеленою на тій самій обіцянці, яку мала ловити. Мутація це показала.
 */
const CONDITION = {
  uk: /оформ\w*|оплат\w*|коли друг|з підпискою/i,
  en: /subscrib(?:es|ing|e)\b|once they|who pays/i,
  sv: /prenumererar|prenumerera\b|när vännen|som betalar/i,
};

describe("обіцянка реферальної програми", () => {
  for (const key of ["referralBonusVal", "referralBadgeYou"]) {
    it(`${key}: нагорода названа разом з умовою в усіх трьох мовах`, () => {
      for (const l of ["uk", "en", "sv"] as const) {
        const m = new RegExp(`${key}: "([^"]*)"`).exec(loc(l));
        expect(m, `${l}: ключ ${key} існує`).toBeTruthy();
        expect(m![1], `${l}: «${m![1]}» — нагорода без умови`).toMatch(CONDITION[l]);
      }
    });
  }

  it("крок онбордингу «Запроси колегу» теж не обіцяє зайвого", () => {
    for (const l of ["uk", "en", "sv"] as const) {
      const s = loc(l);
      const i = s.indexOf("      referral: {");
      expect(i, `${l}: крок існує`).toBeGreaterThan(0);
      const desc = /desc: "([^"]*)"/.exec(s.slice(i, i + 400))![1];
      expect(desc, `${l}: «${desc}»`).toMatch(CONDITION[l]);
    }
  });

  it("а там, де умову вже називали, вона нікуди не поділась", () => {
    // step3Desc і rewardLinePart3 були правдиві й до правки — ратчет тримає їх.
    expect(/step3Desc: "([^"]*)"/.exec(loc("uk"))![1]).toMatch(/оформ/i);
    expect(/rewardLinePart3: "([^"]*)"/.exec(loc("uk"))![1]).toMatch(/оформ/i);
  });
});
