import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// РОЗТЯЖКА: кожна таблиця/view, яку src читає через supabase.from("x"),
// мусить існувати — у types.ts (жива БД) АБО у міграціях (CREATE TABLE/VIEW).
// 02.08 цей аудит зловив дві таблиці, в які код писав РОКАМИ, а їх не існувало.
describe("db surface invariants", () => {
  it("кожен .from() існує у types.ts або міграціях", () => {
    const src = join(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) { if (!/node_modules/.test(p)) walk(p); }
        else if (/\.(ts|tsx)$/.test(e) && !e.includes(".test.")) files.push(p);
      }
    };
    walk(src);
    const names = new Set<string>();
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      // storage.from(...) — бакети, не таблиці
      const cleaned = t.replace(/storage\s*\.\s*from\(/g, "STORAGE(");
      for (const m of cleaned.matchAll(/\.from\("([a-z_]+)"/g)) names.add(m[1]);
    }
    const types = readFileSync(join(src, "integrations/supabase/types.ts"), "utf8");
    const migDir = join(__dirname, "../../supabase/migrations");
    const migs = readdirSync(migDir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(migDir, f), "utf8")).join("\n");
    const missing = [...names].filter(
      (n) => !types.includes(`${n}:`) &&
             !new RegExp(`CREATE (TABLE|OR REPLACE VIEW|VIEW)[^;]*${n}`, "i").test(migs)
    );
    expect(missing).toEqual([]);
  });
});
