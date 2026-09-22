#!/usr/bin/env node
/**
 * stamp-edge — штамп версії edge-функцій, який ВИДНО з проду.
 *
 * Проблема (§0 спільного контексту, повторювалась тричі): правка в edge-функції
 * лежить у репо тижнями, всі ворота зелені, а прод крутить стару версію, бо
 * Publish edge-функцій не деплоїть. Досі «чи передеплоєно» вгадувалось.
 *
 * Рішення: `supabase/functions/_shared/version.ts` несе хеш ВМІСТУ всіх функцій
 * (не коміту — Lovable деплоїть джерела як є, без збірки, тож хеш має бути в
 * самому джерелі). Функція `version` віддає його назовні; робот у CI порівнює
 * з хешем у репо і каже словами: «edge-функції в проді застарілі — потрібен
 * передеплой». Файл генерується цим скриптом; гейт `--check` падає, якщо хтось
 * змінив функцію й забув перештампувати.
 *
 *   node scripts/stamp-edge.mjs          → перезаписати version.ts
 *   node scripts/stamp-edge.mjs --check  → exit 1, якщо version.ts не відповідає джерелам
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FN = join(ROOT, "supabase", "functions");
const OUT = join(FN, "_shared", "version.ts");
const CHECK = process.argv.includes("--check");

function walk(dir, acc = []) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = walk(FN).filter((p) => p !== OUT && !/\.(test|spec)\.ts$/.test(p));
const h = createHash("sha256");
for (const p of files) {
  h.update(relative(FN, p));
  h.update("\0");
  h.update(readFileSync(p));
  h.update("\0");
}
const stamp = h.digest("hex").slice(0, 8);
const dirs = readdirSync(FN).filter((d) => !d.startsWith("_") && statSync(join(FN, d)).isDirectory());
const body = `// ЗГЕНЕРОВАНО scripts/stamp-edge.mjs — не правити руками.
// Хеш вмісту всіх edge-функцій (${files.length} файлів, ${dirs.length} функцій). Функція \`version\`
// віддає його назовні; робот у CI звіряє з репо і каже, чи прод крутить свіже.
export const EDGE_VERSION = "${stamp}";
export const EDGE_FUNCTIONS = ${dirs.length};
`;

const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
if (CHECK) {
  if (current === body) {
    console.log(`[stamp-edge] ✅ version.ts актуальний (${stamp}, ${dirs.length} функцій)`);
    process.exit(0);
  }
  console.log(`[stamp-edge] ⛔ supabase/functions змінились, а _shared/version.ts — ні. Виконай: node scripts/stamp-edge.mjs (очікуваний штамп ${stamp})`);
  process.exit(1);
}
writeFileSync(OUT, body);
console.log(`[stamp-edge] version.ts → ${stamp} (${files.length} файлів, ${dirs.length} функцій)`);
