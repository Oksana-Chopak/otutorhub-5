import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname ?? __dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Ворота «існує, але не дозволено» (27.10).
 *
 * Картка учня пів місяця віддавала «Не вдалося завантажити матеріали» КОЖНІЙ
 * ролі. Ні код запиту, ні схема не були винні: `lesson_details.student_price` у
 * types.ts є, а SELECT на нього в `authenticated` відкликаний міграцією
 * 20260715000000 — і Postgres відмовляє у ВСЬОМУ запиті (42501). Ворота
 * `check-db-select` цього не бачать за визначенням: types.ts не показує прав.
 * Тому права перевіряються на прогнаній базі, після фази B.
 */
describe("ворота прав на колонки", () => {
  it("скрипт існує і вшитий у прогін бази", () => {
    expect(existsSync(join(ROOT, "scripts/db-replay/check-grants.mjs"))).toBe(true);
    const replay = read("scripts/db-replay/replay.mjs");
    expect(replay, "інакше ворота існують, але ніколи не біжать").toContain('sub("check-grants.mjs")');
    expect(replay, "права видно лише коли схема повна — після фази B")
      .toMatch(/check-edge-rpc-grants\.mjs[\s\S]{0,600}check-grants\.mjs/);
  });

  it("роль береться за місцем коду: браузер — authenticated, edge — service_role", () => {
    // Та сама колонка може бути дозволена службовій ролі й закрита браузеру;
    // перевірка «взагалі комусь можна» нічого не варта.
    const g = read("scripts/db-replay/check-grants.mjs");
    expect(g).toContain('file.startsWith("supabase/functions/") ? "service_role" : "authenticated"');
    expect(g, "питаємо саме право на SELECT").toContain("has_column_privilege(role, oid, col, 'SELECT')");
  });

  it("парсер ОДИН: ворота прав беруть пари з check-db-select, а не розбирають код удруге", () => {
    const g = read("scripts/db-replay/check-grants.mjs");
    expect(g).toContain("scripts/check-db-select.mjs");
    expect(g).toContain("--emit-json");
    const sel = read("scripts/check-db-select.mjs");
    expect(sel).toContain('process.argv.includes("--emit-json")');
    // Пастка, на якій це вже раз зламалось: process.stdout.write асинхронний, і
    // process.exit обрізав JSON рівно на 64 КіБ — перевірка отримувала половину
    // пар і мовчки не ловила нічого.
    expect(sel, "синхронний запис у fd 1").toContain("writeFileSync(1,");
    expect(sel, "не повертати асинхронний write").not.toMatch(/process\.stdout\.write\(JSON\.stringify\(tuples/);
  });

  it("перевірка не вакуумна: пар справді багато і JSON цілий", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/check-db-select.mjs"), "--emit-json"], {
      encoding: "utf8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
    });
    expect(r.status).toBe(0);
    const tuples = JSON.parse(r.stdout) as [string, string, string, number][];
    expect(tuples.length, "менше тисячі пар — щось відвалилось у парсері").toBeGreaterThan(1000);
    expect(new Set(tuples.map((t) => `${t[0]}.${t[1]}`)).size, "унікальних колонок").toBeGreaterThan(250);
    // саме та пара, через яку ворота й зʼявились, мусить бути серед перевіряних
    expect(tuples.some((t) => t[0] === "lessons_visible" && t[1] === "student_price")).toBe(true);
  });

  it("картка учня читає гроші з lessons_visible, а не з lesson_details", () => {
    const sm = read("src/components/StudentMaterials.tsx");
    expect(sm).toContain('supabase.from("lessons_visible")');
    expect(sm, "грошові колонки більше не беруться напряму з lesson_details")
      .not.toMatch(/from\("lesson_details"\)[\s\S]{0,200}student_price/);
  });
});
