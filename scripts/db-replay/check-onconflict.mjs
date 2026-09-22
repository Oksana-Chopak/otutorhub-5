#!/usr/bin/env node
/**
 * check-onconflict — кожен `onConflict` у коді = справжній унікальний ключ у базі.
 *
 * Урок 22.09: міграція `20260915100000` додала `student_id` в унікальний ключ логу
 * нагадувань, а спільний модуль ручного «Нагадати» лишився зі старим
 * `onConflict: "lesson_id,reminder_kind,channel"`. Postgres відповідає 42P10
 * («there is no unique or exclusion constraint matching the ON CONFLICT
 * specification»), upsert падає — і з 16.09 до 22.09 ручні нагадування тихо
 * не писались у лог. Ні typecheck, ні vitest, ні гейт колонок цього не бачать:
 * набір колонок в onConflict — просто рядок.
 *
 * Тут кожен `.from("t") … .upsert(…, { onConflict: "a,b" })` у src/ і
 * supabase/functions/ звіряється з унікальними індексами/обмеженнями таблиці в
 * базі, яку зібрав db-replay (повна історія міграцій). Набір колонок мусить
 * збігатись ТОЧНО (порядок неважливий) з якимось унікальним індексом без
 * предиката — саме так це перевіряє Postgres.
 *
 * Запуск: PGPORT=… REPLAY_DB=<база після replay --keep> node scripts/db-replay/check-onconflict.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const PGHOST = process.env.PGHOST ?? "/tmp";
const PGPORT = process.env.PGPORT ?? "5432";
const PGUSER = process.env.PGUSER ?? "postgres";
const DB = process.env.REPLAY_DB;
if (!DB) {
  console.error("REPLAY_DB не задано — спершу `node scripts/db-replay/replay.mjs --keep`");
  process.exit(2);
}

function q(sql) {
  const r = spawnSync("psql", ["-X", "-A", "-t", "-F", "\t", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", DB, "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
}

// Унікальні ключі: індекси (unique, без WHERE) + PRIMARY KEY/UNIQUE constraints.
const uniq = new Map(); // table -> [Set(cols)]
for (const [table, cols] of q(`
  SELECT t.relname, string_agg(a.attname, ',' ORDER BY k.ord)
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
  WHERE n.nspname = 'public' AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
  GROUP BY t.relname, i.indexrelid`)) {
  if (!uniq.has(table)) uniq.set(table, []);
  uniq.get(table).push(new Set(cols.split(",")));
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (/node_modules|\.git|dist|__tests__|test$|tests$/.test(e)) continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.|\.spec\.|\.d\.ts$/.test(e)) acc.push(p);
  }
  return acc;
}
const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase/functions"))];

const problems = [];
let checked = 0;
const RE = /\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)([\s\S]{0,600}?)onConflict\s*:\s*["'`]([a-z0-9_,\s]+)["'`]/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  let m;
  while ((m = RE.exec(src))) {
    const [, table, between, spec] = m;
    // між from() і onConflict не має бути іншого from() — інакше це вже інший запит
    if (/\.from\(/.test(between)) continue;
    checked++;
    const want = new Set(spec.split(",").map((s) => s.trim()).filter(Boolean));
    const keys = uniq.get(table);
    const line = src.slice(0, m.index).split("\n").length;
    const where = `${relative(ROOT, f)}:${line}`;
    if (!keys) { problems.push(`${where}: таблиця "${table}" не має жодного унікального ключа (або не існує) — onConflict "${spec}"`); continue; }
    const ok = keys.some((k) => k.size === want.size && [...want].every((c) => k.has(c)));
    if (!ok) {
      problems.push(`${where}: ${table} onConflict "${spec}" ≠ жодному унікальному ключу [${keys.map((k) => [...k].join(",")).join(" | ")}] → Postgres 42P10, upsert мовчки падає`);
    }
  }
}

console.log(`[check-onconflict] перевірено ${checked} upsert(onConflict) у ${files.length} файлах; порушень ${problems.length}`);
for (const p of problems) console.log(`  ⛔ ${p}`);
if (problems.length) process.exit(1);
