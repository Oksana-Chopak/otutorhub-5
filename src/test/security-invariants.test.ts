import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// SECURITY TRIPWIRE: студент бачить лише скопійований `summary`.
// Жодна МАЙБУТНЯ версія view lesson_details_student не може тягнути fireflies_*
// (сирий AI-вивід). Порушення = червона батарея, коміт не проходить.
describe("security invariants: student view", () => {
  it("остання версія lesson_details_student не містить fireflies_*", () => {
    const dir = join(__dirname, "../../supabase/migrations");
    const defs = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => /VIEW public\.lesson_details_student/.test(readFileSync(join(dir, f), "utf8")));
    expect(defs.length).toBeGreaterThan(0);
    const last = readFileSync(join(dir, defs[defs.length - 1]), "utf8");
    const viewBlock = last.slice(last.lastIndexOf("VIEW public.lesson_details_student"));
    expect(/fireflies_/.test(viewBlock)).toBe(false);
  });
});
