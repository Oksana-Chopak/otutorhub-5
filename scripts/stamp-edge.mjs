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
const hashOf = (list) => {
  const h = createHash("sha256");
  for (const p of list) {
    h.update(relative(FN, p));
    h.update("\0");
    h.update(readFileSync(p));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 8);
};
const stamp = hashOf(files);
const dirs = readdirSync(FN).filter((d) => !d.startsWith("_") && statSync(join(FN, d)).isDirectory());

/* 01.10 — ШТАМП ПО ФУНКЦІЇ, а не один на всіх.
   Lovable передеплоює ЛИШЕ змінені функції, а штамп був один на весь пакет —
   тож будь-яка правка в одній функції робила «застарілими» всі решту, яких
   ніхто не чіпав. Ранковий звіт 01.10 назвав застарілими `version`,
   `payment-reminders`, `send-push` і `remind-payment`, у яких НУЛЬ власних
   змін із моменту деплою: друга хибна тривога з цієї ж проби (перша —
   «remind-payment 401» 23.09). Червоне, на яке не треба реагувати, привчає
   ігнорувати червоне.
   Хеш функції = спільний код (`_shared/*` без самого штампу) + її власні файли.
   Тобто правка в `_shared` чесно позначає всі (вони його й збирають у себе), а
   правка в одній функції — лише її. */
const sharedFiles = files.filter((p) => relative(FN, p).startsWith("_shared"));
const fnVersions = Object.fromEntries(
  dirs.map((d) => {
    const own = files.filter((p) => relative(FN, p).split("/")[0] === d);
    return [d, hashOf([...sharedFiles, ...own])];
  }),
);
const mapLines = Object.entries(fnVersions).map(([k, v]) => `  "${k}": "${v}",`).join("\n");
const body = `// ЗГЕНЕРОВАНО scripts/stamp-edge.mjs — не правити руками.
// Хеш вмісту всіх edge-функцій (${files.length} файлів, ${dirs.length} функцій). Функція \`version\`
// віддає його назовні; робот у CI звіряє з репо і каже, чи прод крутить свіже.
export const EDGE_VERSION = "${stamp}";
export const EDGE_FUNCTIONS = ${dirs.length};

// Штамп КОЖНОЇ функції окремо: спільний код + її власні файли. Lovable
// передеплоює лише змінені, тож один штамп на пакет давав хибне «застаріла»
// для функцій, яких ніхто не чіпав (ранковий звіт 01.10). Робот звіряє поіменно.
export const EDGE_FN_VERSION: Record<string, string> = {
${mapLines}
};
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
