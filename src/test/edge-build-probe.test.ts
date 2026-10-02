/**
 * 22.09 — «чи справді функція оновилась у проді?». Стара й нова версія
 * edge-функції ззовні відповідали однаково, тож агент не міг перевірити
 * передеплой сам і мусив просити власницю переказувати Lovable. Тепер
 * GET ?version віддає мітку збірки — без даних і ДО перевірки доступу.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { versionProbe, EDGE_BUILD, edgeBuildOf } from "../../supabase/functions/_shared/build";
import { EDGE_VERSION, EDGE_FUNCTIONS, EDGE_FN_VERSION } from "../../supabase/functions/_shared/version";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const FNS = ["payment-reminders", "send-push", "tutor-daily-digest", "telegram-poll", "remind-payment"];

describe("перевірка версії edge-функцій", () => {
  it("GET ?version → мітка збірки, читається з браузера (CORS), без кешу", async () => {
    const r = versionProbe(new Request("https://x.supabase.co/functions/v1/send-push?version"), "send-push")!;
    expect(r.status).toBe(200);
    /* 01.10: `build` — штамп САМОЇ функції, `pkg` — пакетний (як інформація).
       Пакетним штампом порівнювати не можна: Lovable передеплоює лише змінені
       функції, тож решта «застарівала» без жодної своєї зміни — ранковий звіт
       01.10 назвав такими чотири функції з нулем власних правок. */
    expect(await r.json()).toEqual({
      fn: "send-push", build: edgeBuildOf("send-push"), pkg: EDGE_BUILD, functions: EDGE_FUNCTIONS,
    });
    expect(edgeBuildOf("send-push"), "штамп функції ≠ пакетний").not.toBe(EDGE_BUILD);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("будь-що інше проходить далі як було (POST, GET без ?version)", () => {
    expect(versionProbe(new Request("https://x/f?version", { method: "POST", body: "{}" }), "f")).toBeNull();
    expect(versionProbe(new Request("https://x/f"), "f")).toBeNull();
    expect(versionProbe(new Request("https://x/f?v=1"), "f")).toBeNull();
  });

  /* Властивість, через яку й зроблено штамп по функції: правка в ОДНІЙ функції
     не робить «застарілими» решту. Перевіряємо на самій мапі, а не на прозі. */
  it("штамп у кожної функції свій, а _shared змінює всіх", () => {
    const names = Object.keys(EDGE_FN_VERSION);
    expect(names.length, "усі функції в мапі").toBeGreaterThan(40);
    expect(new Set(Object.values(EDGE_FN_VERSION)).size, "однакових штампів бути не може")
      .toBe(names.length);
    for (const n of FNS) expect(EDGE_FN_VERSION[n], `${n} має власний штамп`).toMatch(/^[0-9a-f]{8}$/);
    // Невідома назва не валить пробу — вона падає на пакетний штамп.
    expect(edgeBuildOf("не-існує")).toBe(EDGE_VERSION);
  });

  it("робот звіряє поіменно, а не одним штампом на пакет", () => {
    const robot = src("tests/prod/smoke.spec.ts");
    expect(robot).toMatch(/const expectedOf = \(name: string\) => EDGE_FN_VERSION\[name\] \?\? EDGE_VERSION;/);
    expect(robot, "список функцій для проби — не руками")
      .toMatch(/versionProbe\\s\*\\\(/);
    expect(robot).toMatch(/seen\[name\] = j\.self \?\? j\.build/);
  });

  it("мітка = авто-штамп вмісту функцій (npm run stamp), а не ручне число", () => {
    expect(EDGE_BUILD).toMatch(/^[0-9a-f]{8}$/);
    expect(EDGE_BUILD).toBe(EDGE_VERSION);
  });

  for (const fn of FNS) {
    it(`${fn}: перевірка версії стоїть ПЕРШОЮ — до ключів, секретів і доступу`, () => {
      const s = src(`supabase/functions/${fn}/index.ts`);
      expect(s).toMatch(/import \{ versionProbe \} from "\.\.\/_shared\/build\.ts";/);
      // 27.09: cron-функції обгорнуті withJob("<fn>", …) — «мертвий вимикач»;
      // проба версії й далі мусить стояти першою ВСЕРЕДИНІ обробника.
      const m = /Deno\.serve\((?:(?:withJob|withErrorLog)\("[a-z-]+", )?async \(req\) => \{/.exec(s);
      expect(m, `${fn}: Deno.serve(async (req) => …) не знайдено`).not.toBeNull();
      const body = s.slice(m!.index);
      // перші рядки обробника: дозволено лише відповідь на CORS-preflight
      const lines = body.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
      const head = lines[0].startsWith('if (req.method === "OPTIONS")') ? lines.slice(1) : lines;
      expect(head[0], `${fn}: перший рядок обробника`).toBe(`const probe = versionProbe(req, "${fn}");`);
      expect(head[1]).toBe("if (probe) return probe;");
    });
  }
});
