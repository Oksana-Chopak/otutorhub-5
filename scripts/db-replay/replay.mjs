#!/usr/bin/env node
/**
 * db-replay — ПРОГІН усієї історії міграцій на чистому Postgres.
 *
 * Навіщо (рішення 13.09 і урок 22.09): зміни в базі перевіряються прогоном, а не
 * читанням. Міграція, що падає тут, впала б і в Lovable; ключ, який змінився в
 * базі, а код лишився зі старим `onConflict`, тут видно ДО того, як власниця
 * вставить SQL. Стенд `demo/fake` тригерів не бачить за визначенням — цей бачить.
 *
 * Що робить:
 *   1. створює порожню базу, накладає bootstrap.sql («порожній Supabase»);
 *   2. застосовує КОЖЕН файл supabase/migrations/*.sql у порядку імен, кожен у
 *      власній транзакції (як робить Supabase);
 *   3. звіряє зібрану схему з живим дзеркалом types.ts (compare-types.mjs) і кожен
 *      onConflict у коді — з унікальними ключами (check-onconflict.mjs);
 *   4. прогоняє сценарії scripts/db-replay/scenarios/*.sql — кожен мусить
 *      завершитись без помилки (усередині — власні RAISE EXCEPTION);
 *   5. друкує підсумок і виходить з кодом 1, якщо щось упало.
 *
 * Змінні: PGHOST/PGPORT/PGUSER/PGPASSWORD (як у psql). За замовчуванням —
 * локальний сокет /tmp, порт 5432, користувач postgres.
 *
 * Відомі особливості історії (не помилки):
 *   • розширення pg_cron / pg_net / pgmq / supabase_vault / pg_graphql / pgsodium
 *     у чистому Postgres відсутні — їхні CREATE EXTENSION пропускаються, замість
 *     них працюють заглушки з bootstrap.sql;
 *   • файл `20260907130000_hub_scope_assert.sql` — це перевірка, не зміна: на
 *     порожній базі він має надрукувати «✅ Хаб-скоуп: чисто».
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const SCEN = join(HERE, "scenarios");

const PGHOST = process.env.PGHOST ?? "/tmp";
const PGPORT = process.env.PGPORT ?? "5432";
const PGUSER = process.env.PGUSER ?? "postgres";
const KEEP = process.argv.includes("--keep");
const ONLY_SCENARIOS = process.argv.includes("--scenarios-only");
const DB = process.env.REPLAY_DB ?? `replay_${Date.now().toString(36)}`;

const SKIP_EXT = /^\s*CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?"?(pg_cron|pg_net|pgmq|supabase_vault|pg_graphql|pgsodium|pgjwt|pg_stat_statements|wrappers|plpgsql)"?[^;]*;/gim;

// Історія проду ≠ список файлів: history.json каже, які файли в прод не потрапили
// ніколи (їх не прогоняємо — інакше схема стенда розходиться з живою) і які
// падають на чистому Postgres з відомої причини. Жоден із них не може стояти
// ВИЩЕ водяного знаку Lovable — усе, що ще може поїхати в прод, прогоняється.
const history = JSON.parse(readFileSync(join(HERE, "history.json"), "utf8"));
const isLovableHash = (f) => /^\d{14}_[0-9a-f]{8}-[0-9a-f]{4}-/.test(f);

function psql(args, { input, db = DB, ignoreError = false } = {}) {
  const r = spawnSync(
    "psql",
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", db, ...args],
    { input, encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning -c search_path=public,extensions" } },
  );
  if (r.status !== 0 && !ignoreError) {
    const err = new Error((r.stderr || r.stdout || "psql failed").trim());
    err.stdout = r.stdout;
    err.stderr = r.stderr;
    throw err;
  }
  return r;
}

function preprocess(sql) {
  return sql.replace(SKIP_EXT, (m) => `-- [db-replay] пропущено (розширення недоступне на чистому Postgres): ${m.replace(/\s+/g, " ").trim()}`);
}

const t0 = Date.now();
const results = { applied: [], failed: [], expectedFailures: [], scenariosOk: [], scenariosFailed: [] };

if (!ONLY_SCENARIOS) {
  psql(["-c", `DROP DATABASE IF EXISTS "${DB}"`], { db: "postgres" });
  psql(["-c", `CREATE DATABASE "${DB}"`], { db: "postgres" });
  psql(["-f", join(HERE, "bootstrap.sql")]);
  console.log(`[db-replay] база ${DB}: порожній Supabase готовий`);

  const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  const hashes = all.filter(isLovableHash);
  const watermark = hashes.length ? hashes[hashes.length - 1].slice(0, 14) : "00000000000000";
  for (const f of [...Object.keys(history.neverApplied), ...Object.keys(history.knownFailures)]) {
    if (!all.includes(f)) { console.log(`⛔ history.json згадує файл, якого немає: ${f}`); process.exit(1); }
    if (f.slice(0, 14) > watermark) { console.log(`⛔ history.json не може містити файл ВИЩЕ водяного знаку ${watermark}: ${f} — він ще може поїхати в прод, тож мусить прогонятись`); process.exit(1); }
  }
  const files = all.filter((f) => !(f in history.neverApplied));
  const tmp = join(tmpdir(), `db-replay-${process.pid}`);
  mkdirSync(tmp, { recursive: true });

  const applyOne = (f) => {
    const sql = preprocess(readFileSync(join(MIG, f), "utf8"));
    const p = join(tmp, f);
    writeFileSync(p, sql);
    try {
      psql(["--single-transaction", "-f", p]);
      // журнал версій — як його веде Supabase (потрібен для read-only перевірок)
      psql(["-c", `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${f.slice(0, 14)}', '${f.replace(/'/g, "''")}') ON CONFLICT DO NOTHING`]);
      results.applied.push(f);
      if (f in history.knownFailures) console.log(`ℹ️ ${f} — у history.json як відомий провал, але застосувався; прибери його зі списку`);
      return true;
    } catch (e) {
      const msg = String(e.message).split("\n").filter((l) => /ERROR|DETAIL|HINT|LINE|CONTEXT/.test(l)).slice(0, 6).join("\n    ");
      if (f in history.knownFailures) {
        results.expectedFailures.push(f);
      } else {
        results.failed.push({ f, msg });
        console.log(`❌ ${f}\n    ${msg}`);
      }
      return false;
    }
  };
  const sub = (script) => {
    const r = spawnSync(process.execPath, [join(HERE, script)], { encoding: "utf8", env: { ...process.env, REPLAY_DB: DB, PGHOST, PGPORT, PGUSER }, cwd: ROOT });
    process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status === 0;
  };

  // Фаза A — те, що в проді ВЖЕ є: усе до водяного знаку Lovable включно.
  const live = files.filter((f) => f.slice(0, 14) <= watermark);
  const pending = files.filter((f) => f.slice(0, 14) > watermark);
  for (const f of live) applyOne(f);
  console.log(`[db-replay] фаза A (прод сьогодні): ${live.length} файлів; пропущено як «ніколи не в проді»: ${Object.keys(history.neverApplied).length}; відомих історичних провалів: ${results.expectedFailures.length}/${Object.keys(history.knownFailures).length}`);

  // Схема «прод сьогодні» мусить збігатися з types.ts до колонки, а кожен
  // onConflict у коді — з ключами, які в проді є ЗАРАЗ (інакше upsert падає до
  // того, як власниця вставить SQL).
  if (!sub("compare-types.mjs")) results.failed.push({ f: "compare-types (прод сьогодні)", msg: "див. вище" });
  if (pending.length && !sub("check-onconflict.mjs")) {
    console.log("⚠️ Поки SQL вище не вставлено в Lovable, цей upsert у проді падатиме. Порядок доставки: спершу SQL, потім Publish.");
  }

  // Фаза B — те, що ще ЧЕКАЄ на вставку в Lovable: мусить накластись начисто.
  for (const f of pending) applyOne(f);
  if (pending.length) console.log(`[db-replay] фаза B (очікують SQL у Lovable, вище знаку ${watermark}): ${pending.map((f) => f.slice(0, 14)).join(", ")}`);
  if (!sub("check-onconflict.mjs")) results.failed.push({ f: "check-onconflict (після SQL)", msg: "див. вище" });
}

if (existsSync(SCEN)) {
  const scen = readdirSync(SCEN).filter((f) => f.endsWith(".sql")).sort();
  for (const f of scen) {
    try {
      const r = psql(["-f", join(SCEN, f)]);
      const notices = (r.stderr || "").split("\n").filter((l) => /NOTICE|✅/.test(l)).map((l) => l.replace(/^psql:.*?NOTICE:\s*/, "").trim());
      results.scenariosOk.push({ f, notices });
      console.log(`✅ сценарій ${f}${notices.length ? " — " + notices.join(" · ") : ""}`);
    } catch (e) {
      const msg = String(e.message).split("\n").filter((l) => /ERROR|DETAIL|HINT|CONTEXT/.test(l)).slice(0, 6).join("\n    ");
      results.scenariosFailed.push({ f, msg });
      console.log(`❌ сценарій ${f}\n    ${msg}`);
    }
  }
}

if (!KEEP && !ONLY_SCENARIOS) {
  psql(["-c", `DROP DATABASE IF EXISTS "${DB}"`], { db: "postgres", ignoreError: true });
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(
  `\n[db-replay] міграцій застосовано ${results.applied.length}, упало ${results.failed.length}; ` +
    `сценаріїв пройшло ${results.scenariosOk.length}, упало ${results.scenariosFailed.length} · ${secs}s` +
    (KEEP ? ` · база ${DB} збережена` : ""),
);
if (results.failed.length || results.scenariosFailed.length) process.exit(1);
