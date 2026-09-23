import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
 * Тут перевіряються ОБИДВА проєкти з references: `tsconfig.app.json` (бачить
 * `src/`) і `tsconfig.node.json` (бачить `vite.config.ts`). Другий додано 23.09:
 * імпорт `./scripts/source-stamp.mjs` у vite.config.ts проходив усі ворота
 * (app-проєкт його не бачить, vite build типів не перевіряє), а збірка превʼю в
 * Lovable упала на TS7016 — Lovable сам дописав `scripts/source-stamp.d.mts`.
 * Ворота, що бачать не все дерево, — це знову «зелений гейт, який бреше».
 */
describe("гейт типів (tsconfig.app.json + tsconfig.node.json)", () => {
  it("tsc не знаходить помилок у src/", () => {
    expect(() =>
      execFileSync("npx", ["tsc", "-p", "tsconfig.app.json", "--noEmit"], {
        stdio: "pipe",
        encoding: "utf-8",
      }),
    ).not.toThrow();
  }, 240_000);

  it("tsc не знаходить помилок у конфігах збірки (vite.config.ts і те, що він імпортує)", () => {
    expect(() =>
      execFileSync("npx", ["tsc", "-p", "tsconfig.node.json", "--noEmit"], {
        stdio: "pipe",
        encoding: "utf-8",
      }),
    ).not.toThrow();
  }, 120_000);

  it("npm run typecheck перевіряє обидва проєкти — саме його виконують ворота", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toContain("tsconfig.app.json");
    expect(pkg.scripts.typecheck).toContain("tsconfig.node.json");
  });
});
