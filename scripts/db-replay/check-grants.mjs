/* Ворота «існує, але не дозволено» (27.10).
 *
 * ЧОМУ. Картка учня пів місяця віддавала «Не вдалося завантажити матеріали»
 * КОЖНІЙ ролі — репетиторці, менеджеру, суперадміну. Причина не в коді запиту й
 * не в схемі: `StudentMaterials.tsx` читав `lesson_details.student_price`, а
 * міграція 20260715000000 відкликала табличний SELECT і повернула назад усі
 * колонки, КРІМ трьох грошових. Postgres відмовляє у ВСЬОМУ запиті (42501).
 * Ворота `check-db-select` цього не бачили за визначенням: вони звіряють, що
 * колонка ІСНУЄ в types.ts, і нічого не знають про права. types.ts права теж не
 * показує — отже з файлів це не перевіряється взагалі, лише на живій схемі.
 *
 * ЩО РОБИТЬ. Бере ті самі пари (відношення, колонка), які вже розібрав
 * `check-db-select --emit-json` — парсер лишається один, — і питає в прогнаної
 * бази `has_column_privilege` для тієї ролі, під якою цей код насправді
 * побіжить: `src/**` ходить як `authenticated` (браузер), `supabase/functions/**`
 * — як `service_role`. Відсутнє право = падіння з назвою файла й рядка.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const PGHOST = process.env.PGHOST ?? "/tmp";
const PGPORT = process.env.PGPORT ?? "5499";
const PGUSER = process.env.PGUSER ?? "postgres";
const DB = process.env.REPLAY_DB;
if (!DB) { console.error("check-grants: немає REPLAY_DB"); process.exit(1); }

const roleOf = (file) => (file.startsWith("supabase/functions/") ? "service_role" : "authenticated");

const emit = spawnSync(process.execPath, [join(ROOT, "scripts/check-db-select.mjs"), "--emit-json"], {
  encoding: "utf8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
});
if (emit.status !== 0) { console.error("check-grants: парсер запитів не віддав пари\n" + (emit.stderr || "")); process.exit(1); }
const tuples = JSON.parse(emit.stdout);

// Унікальні (відношення, колонка, роль) + перше місце в коді для звіту.
const uniq = new Map();
for (const [rel, col, file, line] of tuples) {
  const role = roleOf(file);
  const key = `${rel}\u0000${col}\u0000${role}`;
  if (!uniq.has(key)) uniq.set(key, { rel, col, role, file, line });
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const values = [...uniq.values()].map((u) => `(${lit(u.rel)},${lit(u.col)},${lit(u.role)})`).join(",");
const sql = `
WITH t(rel, col, role) AS (VALUES ${values}),
 r AS (
   SELECT t.*, to_regclass('public.' || quote_ident(t.rel)) AS oid FROM t
 ),
 known AS (
   SELECT r.* FROM r
    WHERE r.oid IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = r.oid AND a.attname = r.col AND a.attnum > 0 AND NOT a.attisdropped)
 )
SELECT rel || '|' || col || '|' || role
  FROM known
 WHERE NOT has_column_privilege(role, oid, col, 'SELECT')
 ORDER BY 1;`;

const run = spawnSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", DB, "-c", sql], { encoding: "utf8" });
if (run.status !== 0) { console.error("check-grants: psql не впорався\n" + (run.stderr || run.stdout)); process.exit(1); }

const bad = run.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
console.log(`[check-grants] перевірено прав: ${uniq.size} пар (таблиця, колонка) у ${new Set([...uniq.values()].map((u) => u.rel)).size} відношеннях; порушень ${bad.length}`);
if (bad.length === 0) process.exit(0);

console.log(`❌ ${bad.length} звернень до колонок БЕЗ ПРАВА на читання (клас «існує, але не дозволено»):`);
for (const row of bad) {
  const [rel, col, role] = row.split("|");
  const u = uniq.get(`${rel}\u0000${col}\u0000${role}`);
  console.log(`   ${u.file}:${u.line} — ${role} не має SELECT на public.${rel}.${col}`);
  console.log(`      Postgres відмовить у ВСЬОМУ запиті (42501) — екран віддасть порожнечу або «не вдалося завантажити».`);
}
process.exit(1);
