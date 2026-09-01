import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

/**
 * B-хвиля (інструкція якості 31.08), гейти №2 і №3 — ratchet, як
 * role-gates-ratchet і currency-гейт:
 *
 *  1. «Гейт error»: `const { data } = await supabase…` БЕЗ error у деструктурі —
 *     збій читання стає тихим null. Системна цифра на момент фіксації: 101.
 *  2. «Гейт finally»: `setХxxBusy(true)` з await у вікні і без try/finally —
 *     виняток лишає кнопку мертвою до перезавантаження. Було 56 — після
 *     механічного проходу B6 (58 місць обгорнуто try/finally) лишилось 10,
 *     і всі 10 мають finally далі за 50-рядковим вікном евристики.
 *
 * Обидва числа можуть ЛИШЕ ПАДАТИ. Новий код зобовʼязаний читати error і
 * загортати busy у try/finally; знизив борг — знизь baseline у цьому файлі.
 * Евристика однорядкова (мультирядкові деструктури не рахуються) — тому
 * порівнюємо «не більше», а точність тримаємо стабільною, не ідеальною.
 */

const ERRORLESS_BASELINE = 101;
const BUSY_NO_FINALLY_BASELINE = 10;

const files = globSync("src/**/*.{ts,tsx}", {
  ignore: ["src/test/**", "**/*.d.ts"],
});

const errRe = /const\s*\{([^}]*)\}\s*=\s*await\s+supabase/;
const busyRe = /set([A-Z]\w*)\(true\)/;
const busyNames = /(busy|saving|submitting|sending|creating|deleting|marking|reminding|topup|processing|plan)/i;

function countOffenders() {
  let errorless = 0;
  const errorlessAt: string[] = [];
  let busyNoFinally = 0;
  const busyAt: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf-8").split("\n");
    lines.forEach((ln, i) => {
      const m = errRe.exec(ln);
      if (m && !/\berror\b/.test(m[1])) {
        errorless += 1;
        errorlessAt.push(`${f}:${i + 1}`);
      }
      const b = busyRe.exec(ln);
      if (b && busyNames.test(b[1])) {
        const win = lines.slice(i + 1, i + 51);
        if (win.some((w) => w.includes("await ")) && !win.some((w) => w.includes("finally"))) {
          busyNoFinally += 1;
          busyAt.push(`${f}:${i + 1}`);
        }
      }
    });
  }
  return { errorless, errorlessAt, busyNoFinally, busyAt };
}

describe("async hygiene ratchet (гейти error + finally)", () => {
  const c = countOffenders();

  it(`supabase-читань без error — не більше ${ERRORLESS_BASELINE}`, () => {
    if (c.errorless > ERRORLESS_BASELINE) {
      console.error("Нові читання без error:\n" + c.errorlessAt.join("\n"));
    }
    expect(c.errorless).toBeLessThanOrEqual(ERRORLESS_BASELINE);
  });

  it(`busy(true) без try/finally — не більше ${BUSY_NO_FINALLY_BASELINE}`, () => {
    if (c.busyNoFinally > BUSY_NO_FINALLY_BASELINE) {
      console.error("Нові busy без finally:\n" + c.busyAt.join("\n"));
    }
    expect(c.busyNoFinally).toBeLessThanOrEqual(BUSY_NO_FINALLY_BASELINE);
  });
});
