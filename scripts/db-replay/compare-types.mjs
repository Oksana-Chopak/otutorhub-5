#!/usr/bin/env node
/**
 * compare-types — наскільки прогнана історія міграцій збігається з ЖИВОЮ базою.
 *
 * `src/integrations/supabase/types.ts` Lovable генерує з живої бази після кожної
 * міграції — це єдине об'єктивне дзеркало проду, доступне агентам. Тут схема
 * бази, яку зібрав db-replay (таблиці, в'ю, колонки, RPC), звіряється з цим
 * дзеркалом у ОБИДВА боки:
 *
 *   • є в types.ts, нема в прогоні  → у репо бракує міграції (Lovable застосував
 *     щось, чого в історії немає) — стенд і тести брешуть у цьому місці;
 *   • є в прогоні, нема в types.ts  → міграція лежить у репо, а в проді її НЕМАЄ
 *     (або types.ts не перегенеровано після застосування) — код спирається на
 *     те, чого в живій базі немає.
 *
 * Гейт: розбіжностей 0. Історія проду ≠ список файлів (history.json), і саме
 * завдяки цьому списку прогін збігається з живою схемою до колонки (22.09: 79
 * відношень, 81 RPC, 0 розбіжностей). Нова розбіжність = або міграція не
 * застосована, або types.ts не перегенеровано, або history.json бреше.
 *
 * Запуск: PGPORT=… REPLAY_DB=<база після replay --keep> node scripts/db-replay/compare-types.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const types = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");

const PGHOST = process.env.PGHOST ?? "/tmp";
const PGPORT = process.env.PGPORT ?? "5432";
const PGUSER = process.env.PGUSER ?? "postgres";
const DB = process.env.REPLAY_DB;
if (!DB) {
  console.error("REPLAY_DB не задано — спершу `node scripts/db-replay/replay.mjs --keep`");
  process.exit(2);
}

function section(name) {
  const i = types.indexOf(`    ${name}: {`);
  if (i < 0) return "";
  const end = types.indexOf("\n    }\n", i);
  return types.slice(i, end);
}
function parseRows(sec) {
  const out = new Map();
  const re = /\n      ([a-z0-9_]+): \{\n        Row: \{([\s\S]*?)\n        \}/g;
  let m;
  while ((m = re.exec(sec))) {
    out.set(m[1], new Set([...m[2].matchAll(/\n\s+([a-z0-9_]+)\??:/g)].map((x) => x[1])));
  }
  return out;
}
const liveTables = parseRows(section("Tables"));
const liveViews = parseRows(section("Views"));
const liveFns = new Set([...section("Functions").matchAll(/\n      ([a-z0-9_]+): \{/g)].map((m) => m[1]));

function q(sql) {
  const r = spawnSync("psql", ["-X", "-A", "-t", "-F", "\t", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", DB, "-c", sql], { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c search_path=public,extensions" } });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
}
const replayCols = new Map();
for (const [rel, col, kind] of q(`
  SELECT c.table_name, c.column_name, t.table_type
  FROM information_schema.columns c JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public' ORDER BY 1, c.ordinal_position`)) {
  if (!replayCols.has(rel)) replayCols.set(rel, { kind: kind === "VIEW" ? "view" : "table", cols: new Set() });
  replayCols.get(rel).cols.add(col);
}
const replayFns = new Set(q(`
  SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'`).map((r) => r[0]));

const drift = [];
const live = new Map([...liveTables, ...liveViews]);
for (const [rel, cols] of live) {
  const rp = replayCols.get(rel);
  if (!rp) { drift.push(`live-only relation: ${rel}`); continue; }
  for (const c of cols) if (!rp.cols.has(c)) drift.push(`live-only column: ${rel}.${c}`);
}
for (const [rel, rp] of replayCols) {
  const lc = live.get(rel);
  if (!lc) { drift.push(`replay-only relation: ${rel}`); continue; }
  for (const c of rp.cols) if (!lc.has(c)) drift.push(`replay-only column: ${rel}.${c}`);
}
for (const f of liveFns) if (!replayFns.has(f)) drift.push(`live-only function: ${f}`);
// Функції, що є лише в прогоні, у types.ts не потрапляють, якщо вони не EXECUTE для
// authenticated/anon (PostgREST їх не бачить) — тому цей бік не рахуємо.

drift.sort();
console.log(`[compare-types] live: ${live.size} відношень, ${liveFns.size} RPC · прогін: ${replayCols.size} відношень, ${replayFns.size} функцій · розбіжностей ${drift.length}`);
for (const d of drift) console.log(`  ⛔ ${d}`);
if (drift.length) {
  console.log("\n⛔ Історія міграцій і жива схема розійшлись. Або міграція лежить у репо, а в проді її немає (чи types.ts не перегенеровано після Run у Lovable), або в репо бракує того, що Lovable застосував, або history.json неточний. Розберись — і лише тоді правити history.json.");
  process.exit(1);
}
