import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * БЕКАП ПОКРИВАЄ ВСЮ БАЗУ (17.11, сліпа зона).
 *
 * Список таблиць нічного бекапу склали 05.09 — 26 таблиць. До 17.11 у базі їх стало 83, і в
 * бекап не потрапляла вся модель школи (hubs, hub_managers, hub_members), посилання й заявки
 * на оплату, запити учнів, нотатки, доступні години. Ніхто цього не бачив: бекап щоночі
 * звітував «успішно».
 *
 * Тепер кожна таблиця бази мусить бути АБО в бекапі, АБО названа в NOT_BACKED_UP з причиною.
 * Нова таблиця без рішення — червоні ворота.
 */
const root = process.cwd();
const fn = readFileSync(join(root, "supabase/functions/db-backup/index.ts"), "utf-8");
const types = readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf-8");

function between(s: string, from: string, to: string): string {
  const i = s.indexOf(from);
  if (i < 0) return "";
  const j = s.indexOf(to, i + from.length);
  return s.slice(i + from.length, j < 0 ? undefined : j);
}

const backed = new Set(Array.from(between(fn, "const TABLES = [", "] as const;").matchAll(/^\s*"([a-z_0-9]+)",?\s*$/gm)).map((m) => m[1]));
const excluded = new Set(Array.from(between(fn, "export const NOT_BACKED_UP", "};").matchAll(/^\s*([a-z_0-9]+):\s*"/gm)).map((m) => m[1]));
// таблиці живої бази — блок Tables у дзеркалі схеми
const tables = Array.from(between(types, "    Tables: {", "\n    Views: {").matchAll(/^ {6}([a-z_0-9]+): \{$/gm)).map((m) => m[1]);

describe("нічний бекап: кожна таблиця або в бекапі, або свідомо поза ним", () => {
  it("списки читаються", () => {
    expect(backed.size).toBeGreaterThan(50);
    expect(excluded.size).toBeGreaterThan(10);
    expect(tables.length).toBeGreaterThan(70);
  });

  it("немає таблиці без рішення", () => {
    const undecided = tables.filter((t) => !backed.has(t) && !excluded.has(t));
    expect(undecided, "додай таблицю в TABLES (бізнес-дані) або в NOT_BACKED_UP з причиною").toEqual([]);
  });

  it("таблиця не стоїть в обох списках одразу", () => {
    expect([...backed].filter((t) => excluded.has(t))).toEqual([]);
  });

  it("у бекапі немає назв, яких у базі не існує", () => {
    const known = new Set(tables);
    expect([...backed].filter((t) => !known.has(t))).toEqual([]);
  });

  it("школа, гроші і згода на розсилки — у бекапі", () => {
    for (const t of ["hubs", "hub_managers", "hub_members", "lessons", "lesson_details", "student_wallet_transactions",
      "payment_links", "payment_claims", "student_rates", "marketing_unsubscribes", "suppressed_emails"]) {
      expect(backed.has(t), t).toBe(true);
    }
  });

  it("сторінки читаються за ключем таблиці: `id` або запис в ORDER_KEY, і кожна колонка існує", () => {
    // без порядку таблиця понад 1000 рядків копіювалась би з дублями й дірками на межі сторінок
    expect(fn).toMatch(/for \(const col of ORDER_KEY\[table\] \?\? \["id"\]\) q = q\.order\(col, \{ ascending: true \}\)/);
    const keys = new Map(Array.from(between(fn, "export const ORDER_KEY", "};").matchAll(/^\s*([a-z_0-9]+): \[([^\]]+)\],?\s*$/gm))
      .map((m) => [m[1], Array.from(m[2].matchAll(/"([a-z_0-9]+)"/g)).map((x) => x[1])] as [string, string[]]));
    const rowOf = (t: string) => between(between(types, `      ${t}: {\n        Row: {`, "        Insert: {"), "", "\n        }");
    const bad: string[] = [];
    for (const t of backed) {
      const row = rowOf(t);
      for (const col of keys.get(t) ?? ["id"]) {
        if (!new RegExp(`^\\s+${col}\\??: `, "m").test(row)) bad.push(`${t}.${col}`);
      }
    }
    expect(bad, "таблиця без колонки id мусить мати запис в ORDER_KEY зі своїм первинним ключем").toEqual([]);
    expect([...keys.keys()].filter((t) => !backed.has(t)), "ORDER_KEY згадує таблицю, якої в копії немає").toEqual([]);
  });

  it("копія звіряє кількість рядків із базою і каже про розбіжність", () => {
    expect(fn).toMatch(/count: "exact", head: true/);
    expect(fn).toMatch(/tables_row_mismatch: mismatched/);
    expect(fn).toMatch(/tables_mismatched: Object\.keys\(mismatched\)\.length/);
  });

  it("відновлення репетирується в CI після проходів (на базі зі школою, уроками й грошима)", () => {
    const wf = readFileSync(join(root, ".github/workflows/walks.yml"), "utf-8");
    expect(wf).toMatch(/node scripts\/backup-restore\.mjs drill/);
    const tool = readFileSync(join(root, "scripts/backup-restore.mjs"), "utf-8");
    // інструмент читає список таблиць і ключі з джерела функції, а не тримає власну копію
    expect(tool).toMatch(/supabase\/functions\/db-backup\/index\.ts/);
    expect(tool).toMatch(/session_replication_role = replica/);
    expect(tool).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it("секрети доступу до календаря копій не мають", () => {
    expect(backed.has("google_calendar_tokens")).toBe(false);
    expect(excluded.has("google_calendar_tokens")).toBe(true);
  });
});
