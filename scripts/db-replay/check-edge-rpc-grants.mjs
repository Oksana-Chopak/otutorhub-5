#!/usr/bin/env node
/**
 * check-edge-rpc-grants — кожна RPC, яку кличе edge-функція, виконувана для service_role.
 *
 * Клас 13.09 (і повторно у скані Lovable 23.09): `confirm-pending-signup` під
 * service role кликав `is_pending_email`, а «security hardening» 20260501123039
 * зробив `REVOKE EXECUTE … FROM PUBLIC` — для функцій без явного гранту
 * service_role це відібрало право і в самих edge-функцій. Симптом: «permission
 * denied for function», функція відповідає «not pending», запрошений учень
 * застрягає без сліду. Закрито явними грантами 20260913090000 — але наступна
 * нова RPC або наступний REVOKE відкриє це знову.
 *
 * Тут кожен `.rpc("fn")` у supabase/functions/** звіряється з базою, зібраною
 * db-replay (bootstrap НАВМИСНО не дає service_role дефолтного EXECUTE на функції —
 * як у проді): has_function_privilege('service_role', …) мусить бути true для
 * КОЖНОГО перевантаження функції з таким імʼям.
 *
 * Запуск: PGPORT=… REPLAY_DB=<база після replay --keep> node scripts/db-replay/check-edge-rpc-grants.mjs
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
  const r = spawnSync("psql", ["-X", "-A", "-t", "-F", "\t", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", DB, "-c", sql], { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c search_path=public,extensions" } });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(e) && !/\.test\.|\.spec\./.test(e)) acc.push(p);
  }
  return acc;
}
const calls = new Map(); // fn -> [where]
for (const f of walk(join(ROOT, "supabase/functions"))) {
  const src = readFileSync(f, "utf8");
  const re = /\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    const arr = calls.get(m[1]) ?? [];
    arr.push(`${relative(ROOT, f)}:${line}`);
    calls.set(m[1], arr);
  }
}

const problems = [];
let checked = 0;
for (const [fn, where] of calls) {
  const rows = q(`SELECT p.oid::regprocedure, has_function_privilege('service_role', p.oid, 'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${fn}'`);
  if (!rows.length) { problems.push(`${where[0]}: RPC "${fn}" не існує в схемі`); continue; }
  for (const [sig, ok] of rows) {
    checked++;
    if (ok !== "t") problems.push(`${where[0]}: service_role не має EXECUTE на ${sig} → у проді edge-функція отримає «permission denied» (клас 13.09). Ліки: GRANT EXECUTE ON FUNCTION ${sig} TO service_role у новій міграції`);
  }
}
console.log(`[check-edge-rpc-grants] RPC у edge-функціях: ${calls.size} імен, ${checked} сигнатур; порушень ${problems.length}`);
for (const p of problems) console.log(`  ⛔ ${p}`);
if (problems.length) process.exit(1);
