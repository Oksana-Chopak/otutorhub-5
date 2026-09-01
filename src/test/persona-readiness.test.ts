import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

/**
 * Гейт готовності персони (аудит 01.09).
 *
 * `useWorkspaceSettings().isIndependent` = `settings?.independent_workspace ?? false`.
 * Тобто «ще не знаю» невідрізнимо від «хабовий» — і саме звідси взявся цілий
 * клас помилок, який ловився поштучно тричі за один день:
 *   • дашборд показував самостійному репетитору хабовий FAB;
 *   • кнопка AI-конспекту зʼявлялась безкоштовному й зникала під рукою;
 *   • у профілі під власним іменем блимало «Репетитор хабу»;
 *   • форма встигала записати урок із source:"hub" — і той зникав із «Моїх учнів».
 *
 * Правило, яке робить це неможливим: файл, що читає `isIndependent`, ЗОБОВʼЯЗАНИЙ
 * згадувати й готовність — `roleReady` (бажано), `wsLoading` або `workspaceUnknown`.
 * Просто `loading` не рахується навмисно: у сторінках так називають своє власне
 * завантаження даних, і саме ця плутанина двічі давала хибне відчуття безпеки.
 *
 * Порушників — 0. Число може лише лишатись нулем.
 */

const READINESS = /roleReady|wsLoading|workspaceUnknown/;

const EXEMPT = new Set([
  "src/hooks/useWorkspaceSettings.tsx", // сам джерело правди
  "src/lib/roleCapabilities.ts",        // чиста матриця можливостей, без рендеру
]);

describe("гейт готовності персони", () => {
  it("кожен файл із isIndependent перевіряє готовність", () => {
    const files = globSync("src/**/*.{ts,tsx}", { ignore: ["src/test/**", "**/*.d.ts"] });
    const offenders = files.filter((f) => {
      if (EXEMPT.has(f)) return false;
      const s = readFileSync(f, "utf-8");
      return s.includes("isIndependent") && !READINESS.test(s);
    });
    if (offenders.length) {
      console.error(
        "Ці файли вирішують долю UI за персоною, не переконавшись, що персона вже відома:\n" +
          offenders.join("\n") +
          "\nВізьми з useWorkspaceSettings() ще й roleReady і перевір його.",
      );
    }
    expect(offenders).toEqual([]);
  });
});
