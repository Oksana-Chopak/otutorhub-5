import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Гейт типів. Причина існування, коротко і конкретно:
 *
 * кореневий `tsconfig.json` має `"files": []` і лише `references`, тому
 * `npx tsc --noEmit` НЕ перевіряє жодного файла застосунку і завжди каже «0
 * помилок». `npm run build` — це `vite build` без перевірки типів. Через цю
 * пару 01.09 у main поїхали два виклики `useEscapeKey` без імпорту: дашборд
 * самостійного репетитора і весь онбординг падали в ErrorBoundary, а всі
 * ворота світилися зеленим.
 *
 * Тут перевіряється саме `tsconfig.app.json` — той, що бачить `src/`.
 */
describe("гейт типів (tsconfig.app.json)", () => {
  it("tsc не знаходить помилок у src/", () => {
    expect(() =>
      execFileSync("npx", ["tsc", "-p", "tsconfig.app.json", "--noEmit"], {
        stdio: "pipe",
        encoding: "utf-8",
      }),
    ).not.toThrow();
  }, 240_000);
});
