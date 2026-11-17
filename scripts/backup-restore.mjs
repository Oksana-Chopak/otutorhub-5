#!/usr/bin/env node
/**
 * ВІДНОВЛЕННЯ З НІЧНОЇ КОПІЇ — інструмент і репетиція (17.11).
 *
 * Нічна копія (`supabase/functions/db-backup`) існує з 05.09, але з неї ще НІ РАЗУ не
 * відновлювали. Копія, з якої не вміють відновитись, — припущення, а не страховка. Цей скрипт:
 *
 *   node scripts/backup-restore.mjs drill
 *       Репетиція на стенді: знімає копію з бази стенда в ТОМУ САМОМУ форматі, що й нічна
 *       функція (ті самі таблиці й порядок — читаються з її джерела), піднімає чисту базу з
 *       історії міграцій, відновлює в неї копію і звіряє КОЖНУ таблицю: кількість рядків і
 *       відбиток вмісту. Біжить у CI після проходів — на базі, де вже є школа, уроки, гроші.
 *
 *   node scripts/backup-restore.mjs restore --file <копія.json[.gz]> --db <база> [--only a,b] [--replace]
 *       Справжнє відновлення. Типово лише ДОДАЄ рядки, яких бракує (ON CONFLICT DO NOTHING) —
 *       безпечно для випадку «стерли частину таблиці»: наявне не чіпається. `--replace` спершу
 *       спорожнює названі таблиці (для відновлення в чисту базу). `--only` — лише ці таблиці.
 *       Тригери й перевірки звʼязків на час вставки вимкнені (`session_replication_role =
 *       replica`): рядки лягають як були, без повторних сповіщень, списань гаманця й автоцін.
 *
 * Підключення — звичайні змінні psql (PGHOST / PGPORT / PGUSER / PGPASSWORD).
 * Чого копія НЕ містить (свідомо, див. NOT_BACKED_UP): входи людей (auth.users — веде Supabase
 * Auth), журнали, токени календаря. Після повної втрати проєкту людям довелося б заново
 * задати пароль; після «стерли таблицю» входи на місці.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash, createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FN = readFileSync(join(ROOT, "supabase/functions/db-backup/index.ts"), "utf8");
const TABLES = [...FN.slice(FN.indexOf("const TABLES = ["), FN.indexOf("] as const;")).matchAll(/^\s*"([a-z_0-9]+)",?\s*$/gm)].map((m) => m[1]);
const ORDER_KEY = Object.fromEntries(
  [...FN.slice(FN.indexOf("export const ORDER_KEY"), FN.indexOf("const RETENTION_DAYS")).matchAll(/^\s*([a-z_0-9]+): \[([^\]]+)\],?\s*$/gm)]
    .map((m) => [m[1], [...m[2].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1])]),
);
const keyOf = (t) => ORDER_KEY[t] ?? ["id"];

function psql(db, args, { input } = {}) {
  const r = spawnSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, ...args], { input, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "psql failed").trim().split("\n").slice(0, 4).join("\n"));
  return r.stdout;
}
const q = (db, sql) => psql(db, ["-c", sql]).trim();

/** Копія у форматі нічної функції: ті самі таблиці, той самий порядок сторінок. */
function dump(db) {
  const data = {};
  for (const t of TABLES) {
    const order = keyOf(t).map((c) => `"${c}"`).join(", ");
    data[t] = JSON.parse(q(db, `SELECT coalesce(json_agg(x), '[]') FROM (SELECT * FROM public."${t}" ORDER BY ${order}) x`));
  }
  return {
    exported_at: new Date().toISOString(), project: "otutorhub", tables_included: Object.keys(data), tables_skipped: {},
    row_counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), data,
  };
}

function readBackup(file) {
  const raw = readFileSync(file);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const p = JSON.parse(text);
  if (!p || typeof p.data !== "object") throw new Error("це не копія oTutorHub: немає поля data");
  return p;
}

function restore(db, payload, { only = null, replace = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oth-restore-"));
  const done = {};
  try {
    const names = Object.keys(payload.data).filter((t) => !only || only.includes(t));
    const known = new Set(q(db, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`).split("\n"));
    if (replace) {
      const wipe = names.filter((t) => known.has(t)).map((t) => `DELETE FROM public."${t}";`).join("\n");
      psql(db, ["-c", `SET session_replication_role = replica;\n${wipe}`]);
    }
    for (const t of names) {
      const rows = payload.data[t] ?? [];
      if (!known.has(t)) { done[t] = { skipped: "такої таблиці в базі немає" }; continue; }
      if (rows.length === 0) { done[t] = { rows: 0, inserted: 0 }; continue; }
      // колонки: ті, що є і в копії, і в базі, і які можна вставляти (не обчислювані)
      const cols = q(db, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t}' AND is_generated = 'NEVER' ORDER BY ordinal_position`).split("\n");
      const inFile = new Set(Object.keys(rows[0]));
      const use = cols.filter((c) => inFile.has(c)).map((c) => `"${c}"`).join(", ");
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const tag = `$oth_${Math.random().toString(36).slice(2, 10)}$`;
        const json = JSON.stringify(rows.slice(i, i + 1000));
        if (json.includes(tag)) throw new Error("збіг службової мітки — запусти ще раз");
        const f = join(dir, `${t}-${i}.sql`);
        writeFileSync(f, [
          "SET session_replication_role = replica;",
          `WITH ins AS (INSERT INTO public."${t}" (${use}) OVERRIDING SYSTEM VALUE`,
          `  SELECT ${use} FROM jsonb_populate_recordset(NULL::public."${t}", ${tag}${json}${tag}::jsonb)`,
          "  ON CONFLICT DO NOTHING RETURNING 1) SELECT count(*) FROM ins;",
        ].join("\n"));
        inserted += Number(psql(db, ["-f", f]).trim().split("\n").pop());
      }
      done[t] = { rows: rows.length, inserted };
    }
    // лічильники номерів (serial / identity) — після вставки з готовими номерами
    const seqs = q(db, `SELECT c.table_name || '|' || c.column_name || '|' || pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name)
                        FROM information_schema.columns c WHERE c.table_schema = 'public' AND pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) IS NOT NULL`);
    for (const line of seqs.split("\n").filter(Boolean)) {
      const [t, c, s] = line.split("|");
      if (names.includes(t)) q(db, `SELECT setval('${s}', GREATEST((SELECT coalesce(max("${c}"), 0) FROM public."${t}"), 1))`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return done;
}

/**
 * Відбиток таблиці: кількість рядків + хеш вмісту в порядку ключа.
 * Рядки порівнюються як ЗНАЧЕННЯ: копія зберігає числа як числа, тож `700.00` повертається як
 * `700` — та сама сума, інший запис. Усе інше (текст, дати, вкладений JSON) — дослівно.
 */
function fingerprint(db, t) {
  const order = keyOf(t).map((c) => `"${c}"`).join(", ");
  const rows = JSON.parse(q(db, `SELECT coalesce(json_agg(x), '[]') FROM (SELECT * FROM public."${t}" ORDER BY ${order}) x`));
  return rows.length + ":" + createHash("md5").update(JSON.stringify(rows)).digest("hex");
}

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };

if (cmd === "restore") {
  const file = arg("--file"), db = arg("--db");
  if (!file || !db) { console.error("потрібно: restore --file <копія> --db <база> [--only a,b] [--replace]"); process.exit(2); }
  const payload = readBackup(file);
  const done = restore(db, payload, { only: arg("--only")?.split(",") ?? null, replace: rest.includes("--replace") });
  console.log(`копія від ${payload.exported_at}`);
  for (const [t, r] of Object.entries(done)) console.log(r.skipped ? `  — ${t}: ${r.skipped}` : `  ${t}: у копії ${r.rows}, додано ${r.inserted}`);
} else if (cmd === "drill") {
  const SRC = process.env.DRILL_SRC ?? "stackdb", DST = process.env.DRILL_DST ?? "backup_drill";
  const t0 = Date.now();
  if (TABLES.length < 50) throw new Error("список таблиць копії не прочитався з джерела функції");
  // Обʼєм: після проходів у базі стенда сотні рядків, а дефекти читання сторінками живуть за
  // межею 1000. Тому на час репетиції множимо один справжній урок із його грошовим рядком
  // (таблиця з ключем `id` і таблиця з ключем НЕ `id`) і наприкінці прибираємо копії.
  const VOL = Number(process.env.DRILL_VOLUME ?? 2500);
  const MARK = "__репетиція_копії__";
  const cleanup = () => psql(SRC, ["-c", `SET session_replication_role = replica;
    DELETE FROM public.lesson_details WHERE lesson_id IN (SELECT id FROM public.lessons WHERE subject = '${MARK}');
    DELETE FROM public.lessons WHERE subject = '${MARK}';`]);
  cleanup();
  if (VOL > 0 && Number(q(SRC, "SELECT count(*) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id")) > 0) {
    const cols = (t, skip) => q(SRC, `SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${t}' AND is_generated = 'NEVER' AND column_name NOT IN (${skip})`);
    const lc = cols("lessons", "'id','subject','starts_at'"), dc = cols("lesson_details", "'lesson_id'");
    psql(SRC, ["-c", `SET session_replication_role = replica;
      CREATE TEMP TABLE drill_ids AS SELECT gen_random_uuid() AS id, n FROM generate_series(1, ${VOL}) n;
      INSERT INTO public.lessons (id, subject, starts_at, ${lc})
        SELECT g.id, '${MARK}', now() - (g.n || ' minutes')::interval, ${lc.split(", ").map((c) => "src." + c).join(", ")}
        FROM drill_ids g, (SELECT l.* FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id ORDER BY l.id LIMIT 1) src;
      INSERT INTO public.lesson_details (lesson_id, ${dc})
        SELECT g.id, ${dc.split(", ").map((c) => "src." + c).join(", ")}
        FROM drill_ids g, (SELECT d.* FROM public.lesson_details d JOIN public.lessons l ON l.id = d.lesson_id ORDER BY l.id LIMIT 1) src;`]);
  }
  process.on("exit", () => { try { cleanup(); } catch { /* база вже недосяжна */ } });

  // (0) читання ТИМ ШЛЯХОМ, яким читає нічна функція: через API, сторінками по 1000 за ключем
  // таблиці, під службовою роллю. Ловить колонку порядку, якої немає, і таблицю, що на межі
  // сторінок губить або дублює рядки.
  const api = process.env.DRILL_API ?? "http://127.0.0.1:54322";
  const secret = process.env.JWT_SECRET ?? "local-stack-secret-local-stack-secret-32+";
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role", iss: "local-stack", exp: 4102444800 })}`;
  const jwt = `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
  let apiUp = false;
  try { apiUp = (await fetch(api + "/", { headers: { Authorization: `Bearer ${jwt}` } })).ok; } catch { /* стенда немає */ }
  if (!apiUp) {
    if (process.env.CI) { console.log("❌ (0) API стенда недосяжний — читання шляхом нічної функції не перевірено"); process.exit(1); }
    console.log("— (0) API стенда недосяжний: читання шляхом нічної функції пропущено");
  } else {
    const off = [];
    let big = 0;
    for (const t of TABLES) {
      const order = keyOf(t).map((c) => `${c}.asc`).join(",");
      const seen = new Set();
      let n = 0;
      for (let from = 0; ; from += 1000) {
        const r = await fetch(`${api}/${t}?select=*&order=${order}&limit=1000&offset=${from}`, { headers: { Authorization: `Bearer ${jwt}` } });
        if (!r.ok) { off.push(`${t}: API ${r.status} ${(await r.text()).slice(0, 120)}`); break; }
        const rows = await r.json();
        for (const row of rows) seen.add(keyOf(t).map((c) => row[c]).join("|"));
        n += rows.length;
        if (rows.length < 1000) break;
      }
      const real = Number(q(SRC, `SELECT count(*) FROM public."${t}"`));
      if (real > 1000) big++;
      if (n !== real || seen.size !== real) off.push(`${t}: у базі ${real}, прочитано ${n}, різних ${seen.size}`);
    }
    if (off.length) { console.log("❌ (0) читання шляхом нічної функції розійшлось із базою:\n   " + off.join("\n   ")); process.exit(1); }
    console.log(`✅ (0) читання шляхом нічної функції (API, сторінки по 1000 за ключем): ${TABLES.length} таблиць повні, без дублів (${big} — більші за одну сторінку)`);
  }

  const payload = dump(SRC);
  const total = Object.values(payload.row_counts).reduce((a, b) => a + b, 0);
  const file = join(tmpdir(), `oth-drill-${Date.now()}.json.gz`);
  writeFileSync(file, gzipSync(JSON.stringify(payload)));
  console.log(`копія з «${SRC}»: ${TABLES.length} таблиць, ${total} рядків, ${Math.round(readFileSync(file).length / 1024)} КБ`);

  // чиста база з усієї історії міграцій — як новий проєкт, у який довелося б відновлюватись
  spawnSync("dropdb", ["--if-exists", DST]);
  const rp = spawnSync(process.execPath, [join(ROOT, "scripts/db-replay/replay.mjs"), "--keep"], { encoding: "utf8", env: { ...process.env, REPLAY_DB: DST }, cwd: ROOT, maxBuffer: 1 << 28 });
  if (rp.status !== 0) { console.error(rp.stdout.split("\n").slice(-12).join("\n")); process.exit(1); }

  // (1) повне відновлення в чисту базу
  restore(DST, readBackup(file), { replace: true });
  const bad = [];
  for (const t of TABLES) {
    const a = fingerprint(SRC, t), b = fingerprint(DST, t);
    if (a !== b) bad.push(`${t}: у джерелі ${a.split(":")[0]} рядків, після відновлення ${b.split(":")[0]}${a.split(":")[0] === b.split(":")[0] ? " (вміст відрізняється)" : ""}`);
  }
  if (bad.length) { console.log("❌ (1) повне відновлення розійшлось із джерелом:\n   " + bad.join("\n   ")); process.exit(1); }
  console.log(`✅ (1) повне відновлення в чисту базу: ${TABLES.length} таблиць збіглись із джерелом рядок у рядок`);

  // (2) «стерли частину таблиці»: прибираємо половину уроків і грошей, повертаємо лише їх
  const before = ["lessons", "lesson_details", "student_wallet_transactions"].map((t) => fingerprint(DST, t));
  const others = TABLES.filter((t) => !["lessons", "lesson_details", "student_wallet_transactions"].includes(t)).map((t) => fingerprint(DST, t));
  psql(DST, ["-c", `SET session_replication_role = replica;
    DELETE FROM public.lesson_details WHERE lesson_id IN (SELECT id FROM public.lessons ORDER BY id LIMIT (SELECT count(*) / 2 FROM public.lessons));
    DELETE FROM public.lessons WHERE id IN (SELECT id FROM public.lessons ORDER BY id LIMIT (SELECT count(*) / 2 FROM public.lessons));
    DELETE FROM public.student_wallet_transactions;`]);
  const part = restore(DST, readBackup(file), { only: ["lessons", "lesson_details", "student_wallet_transactions"] });
  const after = ["lessons", "lesson_details", "student_wallet_transactions"].map((t) => fingerprint(DST, t));
  const othersAfter = TABLES.filter((t) => !["lessons", "lesson_details", "student_wallet_transactions"].includes(t)).map((t) => fingerprint(DST, t));
  if (before.join() !== after.join()) { console.log("❌ (2) часткове відновлення не повернуло стерте"); process.exit(1); }
  if (others.join() !== othersAfter.join()) { console.log("❌ (2) часткове відновлення зачепило інші таблиці"); process.exit(1); }
  console.log(`✅ (2) стерту половину уроків і всі рухи гаманця повернуто (${Object.values(part).map((r) => r.inserted).join(" + ")} рядків), решта таблиць не зачеплена`);

  // (3) повторний запуск нічого не дублює
  const again = restore(DST, readBackup(file), {});
  const dup = Object.entries(again).filter(([, r]) => (r.inserted ?? 0) > 0).map(([t, r]) => `${t} +${r.inserted}`);
  if (dup.length) { console.log("❌ (3) повторне відновлення додало рядки: " + dup.join(", ")); process.exit(1); }
  console.log("✅ (3) повторне відновлення нічого не дублює");

  spawnSync("dropdb", ["--if-exists", DST]);
  rmSync(file, { force: true });
  console.log(`✅ репетиція відновлення — ${Math.round((Date.now() - t0) / 1000)} с`);
} else {
  console.error("команди: drill | restore --file <копія> --db <база> [--only a,b] [--replace]");
  process.exit(2);
}
