#!/usr/bin/env node
/**
 * Гейт «колонки в запитах існують у живій схемі» (13.09).
 *
 * Два з семи дефектів скану 13.09 були одного класу: `.select("…, currency")`
 * у lesson_details і `.select("…, location")` у lessons — колонок НЕМАЄ, PostgREST
 * відповідає 400 на ВЕСЬ запит, екран мовчки порожніє (матеріали учня) або
 * функція відповідає 500 (Google Calendar). Ні typecheck, ні vitest цього не
 * ловлять: рядок у select — просто рядок.
 *
 * Тут кожен `.from("t").select("…")` у src/ і supabase/functions/ звіряється з
 * `src/integrations/supabase/types.ts` — живим дзеркалом схеми (Lovable генерує
 * його з бази після кожної міграції). Так само кожен `.rpc("fn")` мусить існувати
 * у Functions. Вкладені вибірки `rel(cols)` перевіряються, якщо rel — таблиця чи
 * вʼю; шаблонні рядки з ${…} пропускаються (їх не зібрати статично).
 *
 * Запуск: node scripts/check-db-select.mjs   (exit 1 при порушеннях)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const types = readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8");

/* Міграції вище водяного знаку Lovable = ще не в базі. Збираємо, які функції
   вони створюють, щоб відрізнити «чекає вставки» від «немає ніде». */
const pendingFns = new Map();
const pending = [];
{
  const MIG = join(root, "supabase/migrations");
  const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  const hashes = all.filter((f) => /^\d{14}_[0-9a-f]{8}-[0-9a-f]{4}-/.test(f));
  const watermark = hashes.length ? hashes[hashes.length - 1].slice(0, 14) : "00000000000000";
  for (const f of all.filter((x) => x.slice(0, 14) > watermark)) {
    const src = readFileSync(join(MIG, f), "utf8");
    for (const mm of src.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\s*\(/g)) {
      if (!pendingFns.has(mm[1])) pendingFns.set(mm[1], f.slice(0, 14));
    }
  }
}

function section(name) {
  const i = types.indexOf(`    ${name}: {`);
  if (i < 0) return "";
  // секція закінчується на рядку "    }" тієї ж глибини
  const end = types.indexOf("\n    }\n", i);
  return types.slice(i, end);
}
function parseRows(sec) {
  const out = new Map();
  const re = /\n      ([a-z0-9_]+): \{\n        Row: \{([\s\S]*?)\n        \}/g;
  let m;
  while ((m = re.exec(sec))) {
    const cols = new Set([...m[2].matchAll(/\n\s+([a-z0-9_]+)\??:/g)].map((x) => x[1]));
    out.set(m[1], cols);
  }
  return out;
}
const tables = parseRows(section("Tables"));
const views = parseRows(section("Views"));
const relations = new Map([...tables, ...views]);
const functions = new Set([...section("Functions").matchAll(/\n      ([a-z0-9_]+): \{/g)].map((m) => m[1]));

// Файли
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
const files = [...walk(join(root, "src")), ...walk(join(root, "supabase/functions"))]
  .filter((f) => !f.includes("/integrations/supabase/types.ts"));

// Розбір select-рядка: top-level коми з урахуванням дужок
function splitTop(s) {
  const out = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const problems = [];
const skipped = [];
let checked = 0;

function checkCols(rel, colsStr, file, line) {
  const cols = relations.get(rel);
  if (!cols) { skipped.push(`${file}:${line} — ${rel}: не таблиця/вʼю у types (звʼязок за FK?) — пропущено`); return; }
  for (const raw of splitTop(colsStr)) {
    let item = raw.replace(/\s+/g, "");
    if (item === "*" || item === "") continue;
    const paren = item.indexOf("(");
    if (paren >= 0) {
      // alias:rel!hint(cols)
      let relName = item.slice(0, paren);
      const inner = item.slice(paren + 1, item.lastIndexOf(")"));
      relName = relName.replace(/^[a-z0-9_]+:/, "").replace(/!.*$/, "");
      if (relations.has(relName)) checkCols(relName, inner, file, line);
      else skipped.push(`${file}:${line} — вкладене ${relName}(…) не розвʼязано (FK-імʼя) — пропущено`);
      continue;
    }
    // alias:col, col::cast, col->json
    let col = item.replace(/^[a-z0-9_]+:/, "").replace(/::.*$/, "").replace(/->.*$/, "").replace(/\.(sum|avg|count|min|max)\(\)$/, "");
    if (!cols.has(col)) problems.push(`${file}:${line} — ${rel}.${col} немає в живій схемі`);
    checked++;
  }
}

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = relative(root, f);
  // .from("t") … .select("cols")
  const fromRe = /\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/g;
  let m;
  while ((m = fromRe.exec(src))) {
    const table = m[1];
    const line = src.slice(0, m.index).split("\n").length;
    // storage.from("bucket") — це сховище, не таблиця
    if (/storage\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index))) continue;
    if (!relations.has(table)) { problems.push(`${rel}:${line} — таблиці/вʼю «${table}» немає в живій схемі`); continue; }
    // select — лише з ЦЬОГО ланцюжка: до наступного .from( або кінця інструкції
    let tail = src.slice(m.index + m[0].length, m.index + 1200);
    const stop = tail.search(/\.from\(|;\s*\n|\n\s*\n/);
    if (stop >= 0) tail = tail.slice(0, stop);
    const sel = /\.select\(\s*(["'`])([\s\S]*?)\1/.exec(tail);
    if (!sel) continue;
    if (sel[1] === "`" && sel[2].includes("${")) { skipped.push(`${rel}:${line} — select із шаблоном — пропущено`); continue; }
    checkCols(table, sel[2], rel, line);
  }
  /* 24.10 — СЛІПА ПЛЯМА, через яку журнал помилок помер непомітно.
     Було рівно одне правило: `.rpc("x"`. Але половина застосунку кличе RPC як
     `(supabase.rpc as any)("x", …)` — каст ставить `)` між `.rpc` і `(`, і та
     регулярка такий виклик НЕ бачила. З 80 різних RPC ворота бачили 49.
     Саме в сліпій половині й сидів `log_client_error`: код поїхав у прод 21.10,
     функції в базі немає, тож жодна помилка з браузера не писалась — а ворота
     звітували «усі select/rpc відповідають живій схемі». Тепер усі форми. */
  const RPC_SHAPES = [
    /\.rpc\s*\(\s*["'`]([a-z0-9_]+)["'`]/g,                  // .rpc("x")
    /\.rpc\s+as\s+any\s*\)\s*\(\s*["'`]([a-z0-9_]+)["'`]/g, // (supabase.rpc as any)("x")
    /\.rpc\s*<[^>]*>\s*\(\s*["'`]([a-z0-9_]+)["'`]/g,        // .rpc<T>("x")
  ];
  for (const re of RPC_SHAPES) {
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      const fn = m[1];
      if (!functions.has(fn)) {
        /* Функція, яку створює міграція ВИЩЕ водяного знаку, — це не помилка
           коду, а відома черга «чекає вставки» (журнал docs/PROD-DB-SYNC.md).
           Називаємо її словами й жовтим, але воріт не валимо: червоне на
           справному стані вчить ігнорувати червоне. Якщо ж функції немає НІДЕ
           — це справжній дефект, і ворота падають. */
        if (pendingFns.has(fn)) pending.push(`${rel}:${line} — RPC «${fn}» створює міграція ${pendingFns.get(fn)}, яка ще не вставлена в базу`);
        else problems.push(`${rel}:${line} — RPC «${fn}» немає в живій схемі`);
      }
      checked++;
    }
  }
}

const verbose = process.argv.includes("--verbose");
console.log(`═ Звірка запитів зі схемою: ${checked} колонок/RPC перевірено, ${skipped.length} пропущено ═`);
if (pending.length) {
  console.log(`⏳ ${pending.length} звернень до функцій із НЕВСТАВЛЕНИХ міграцій (стан — у docs/PROD-DB-SYNC.md):`);
  for (const p of pending) console.log("   " + p);
}
if (verbose) for (const s of skipped) console.log("  · " + s);
if (problems.length) {
  console.log(`❌ ${problems.length} звернень до неіснуючих колонок/таблиць/RPC:`);
  for (const p of problems) console.log("   " + p);
  process.exit(1);
}
console.log("✅ Усі select/rpc відповідають живій схемі");
