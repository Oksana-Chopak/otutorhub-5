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
import { versionProbe, EDGE_BUILD } from "../../supabase/functions/_shared/build";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const FNS = ["payment-reminders", "send-push", "tutor-daily-digest", "telegram-poll", "remind-payment"];

describe("перевірка версії edge-функцій", () => {
  it("GET ?version → мітка збірки, читається з браузера (CORS), без кешу", async () => {
    const r = versionProbe(new Request("https://x.supabase.co/functions/v1/send-push?version"), "send-push")!;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ fn: "send-push", build: EDGE_BUILD });
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("будь-що інше проходить далі як було (POST, GET без ?version)", () => {
    expect(versionProbe(new Request("https://x/f?version", { method: "POST", body: "{}" }), "f")).toBeNull();
    expect(versionProbe(new Request("https://x/f"), "f")).toBeNull();
    expect(versionProbe(new Request("https://x/f?v=1"), "f")).toBeNull();
  });

  it("мітка має вигляд дати пакета — її легко звірити", () => {
    expect(EDGE_BUILD).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  for (const fn of FNS) {
    it(`${fn}: перевірка версії стоїть ПЕРШОЮ — до ключів, секретів і доступу`, () => {
      const s = src(`supabase/functions/${fn}/index.ts`);
      expect(s).toMatch(/import \{ versionProbe \} from "\.\.\/_shared\/build\.ts";/);
      const body = s.slice(s.indexOf("Deno.serve(async (req) => {"));
      // перші рядки обробника: дозволено лише відповідь на CORS-preflight
      const lines = body.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
      const head = lines[0].startsWith('if (req.method === "OPTIONS")') ? lines.slice(1) : lines;
      expect(head[0], `${fn}: перший рядок обробника`).toBe(`const probe = versionProbe(req, "${fn}");`);
      expect(head[1]).toBe("if (probe) return probe;");
    });
  }
});
