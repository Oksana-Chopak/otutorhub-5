#!/usr/bin/env node
/**
 * scripts/check-i18n.mjs
 * Перевіряє:
 * 1. Всі ключі в uk.ts є в en.ts і sv.ts
 * 2. EN і SV не містять кирилиці
 * 3. t() виклики у коді посилаються на ключі що існують
 *
 * Виходить з кодом 1 якщо знайдено проблеми → CI падає
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const LOCALES = join(ROOT, "src/i18n/locales");
const SRC = join(ROOT, "src");

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractLeafKeys(text) {
  // Character-level scanner: immune to glued braces ("…",}), {{placeholders}}
  // inside strings, one-line objects, quoted keys and comments.
  const keys = new Set();
  const path = [];
  let i = 0;
  const n = text.length;
  let pendingKey = null; // key name waiting for its value
  let token = "";

  const isIdent = (c) => /[A-Za-z0-9_$]/.test(c);

  const readString = (quote) => {
    let s = "";
    i++; // skip opening quote
    while (i < n) {
      const c = text[i];
      if (c === "\\") { s += text[i + 1] ?? ""; i += 2; continue; }
      if (c === quote) { i++; break; }
      s += c;
      i++;
    }
    return s;
  };

  while (i < n) {
    const c = text[i];

    // comments
    if (c === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // strings: either a quoted key ("60": …) or a value
    if (c === '"' || c === "'" || c === "`") {
      const str = readString(c);
      let j = i;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === ":") {
        pendingKey = str; // quoted key
        i = j + 1;
      } else if (pendingKey !== null) {
        keys.add([...path, pendingKey].join("."));
        pendingKey = null;
      }
      continue;
    }

    if (isIdent(c)) {
      token = "";
      while (i < n && isIdent(text[i])) { token += text[i]; i++; }
      if (pendingKey !== null) {
        // primitive value (true / null / 123 / identifier ref)
        keys.add([...path, pendingKey].join("."));
        pendingKey = null;
        token = "";
      }
      continue;
    }

    if (c === ":") { if (token) { pendingKey = token; token = ""; } i++; continue; }

    if (c === "{") { if (pendingKey !== null) { path.push(pendingKey); pendingKey = null; } i++; continue; }

    if (c === "}") { if (path.length) path.pop(); i++; continue; }

    if (c === "[") {
      // array value — record the key, skip array contents (strings handled)
      if (pendingKey !== null) { keys.add([...path, pendingKey].join(".")); pendingKey = null; }
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const a = text[i];
        if (a === '"' || a === "'" || a === "`") { readString(a); continue; }
        if (a === "[") depth++;
        else if (a === "]") depth--;
        i++;
      }
      continue;
    }

    i++;
  }
  return keys;
}

function hasCyrillic(s) {
  return /[\u0400-\u04FF]/.test(s);
}

function getAllFiles(dir, exts = [".ts", ".tsx"]) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry)) continue;
      files.push(...getAllFiles(full, exts));
    } else if (exts.includes(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

// ── Load locales ─────────────────────────────────────────────────────────────

const uk = readFileSync(join(LOCALES, "uk.ts"), "utf8");
const en = readFileSync(join(LOCALES, "en.ts"), "utf8");
const sv = readFileSync(join(LOCALES, "sv.ts"), "utf8");

const ukKeys = extractLeafKeys(uk);
const enKeys = extractLeafKeys(en);
const svKeys = extractLeafKeys(sv);

// ── Check 1: Missing keys ─────────────────────────────────────────────────────

const missingEn = [...ukKeys].filter((k) => !enKeys.has(k));
const missingSv = [...ukKeys].filter((k) => !svKeys.has(k));

// Filter out plural variants that are language-specific (_few/_many for Slavic)
const slavicOnly = (k) => k.endsWith("_few") || k.endsWith("_many");
const realMissingEn = missingEn.filter((k) => !slavicOnly(k));
const realMissingSv = missingSv.filter((k) => !slavicOnly(k));

// ── Check 2: Cyrillic in EN/SV ───────────────────────────────────────────────

const cyrillicEn = [];
const cyrillicSv = [];

for (const [locale, text, arr] of [["en", en, cyrillicEn], ["sv", sv, cyrillicSv]]) {
  for (const line of text.split("\n")) {
    const m = line.match(/^\s+(\w+)\s*:\s*["'`](.*?)["'`],?\s*$/);
    if (m && hasCyrillic(m[2])) {
      arr.push(`  ${m[1]}: "${m[2].slice(0, 60)}"`);
    }
  }
}

// ── Check 3: t() calls with missing keys ─────────────────────────────────────

const SKIP_FILES = new Set([
  "PrivacyPage.tsx", "TermsPage.tsx", "mock-data.ts",
  "LandingPage.tsx", "MarketingPage.tsx",
]);

// Раніше тут був список із 25 префіксів — common., schedule., finances.,
// myStudents., profile., groupsPage. … тобто майже весь застосунок. Через нього
// гейт роками показував «✅», поки 26 ключів реально бракувало і користувач
// бачив на екрані сирі рядки на кшталт «myStudents.searchPlaceholder».
// Список спорожнено 01.09 після того, як усі 26 ключів додано в uk/en/sv.
// Не наповнювати його знову: якщо ключа немає — його треба додати, а не сховати.
const SKIP_KEY_PREFIXES = [];

const missingTCalls = new Map(); // key → [files]

for (const file of getAllFiles(SRC)) {
  const fname = file.split("/").pop();
  if (SKIP_FILES.has(fname)) continue;
  if (file.includes("/i18n/")) continue;
  if (file.includes(".test.")) continue;

  const content = readFileSync(file, "utf8");
  const matches = content.matchAll(/\bt\(["']([^"']+)["']/g);
  for (const [, key] of matches) {
    const baseKey = key.split(",")[0].trim();
    // i18next сам добирає суфікс множини (_one/_few/_many/_other) і вміє
    // повертати вкладений обʼєкт чи масив (returnObjects). Обидва випадки —
    // валідні, тож ключ вважається наявним, якщо є він сам, будь-яка його
    // форма множини або хоч один вкладений ключ.
    const existsWithPlural = ["_one", "_few", "_many", "_other", "_zero"]
      .some((sfx) => ukKeys.has(baseKey + sfx));
    const existsAsObject = [...ukKeys].some((k) => k.startsWith(baseKey + "."));
    if (!ukKeys.has(baseKey) && !existsWithPlural && !existsAsObject) {
      // Check if it's just a known-missing prefix (acceptable)
      const knownMissing = SKIP_KEY_PREFIXES.some((p) => baseKey.startsWith(p));
      if (!knownMissing) {
        const list = missingTCalls.get(baseKey) ?? [];
        list.push(file.replace(ROOT, ""));
        missingTCalls.set(baseKey, list);
      }
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

let errors = 0;

if (realMissingEn.length) {
  console.error(`\n❌ EN — відсутні ключі (${realMissingEn.length}):`);
  realMissingEn.slice(0, 20).forEach((k) => console.error(`   ${k}`));
  if (realMissingEn.length > 20) console.error(`   ... і ще ${realMissingEn.length - 20}`);
  errors++;
}

if (realMissingSv.length) {
  console.error(`\n❌ SV — відсутні ключі (${realMissingSv.length}):`);
  realMissingSv.slice(0, 20).forEach((k) => console.error(`   ${k}`));
  if (realMissingSv.length > 20) console.error(`   ... і ще ${realMissingSv.length - 20}`);
  errors++;
}

if (cyrillicEn.length) {
  console.error(`\n❌ EN — кирилиця в перекладах (${cyrillicEn.length}):`);
  cyrillicEn.forEach((l) => console.error(l));
  errors++;
}

if (cyrillicSv.length) {
  console.error(`\n❌ SV — кирилиця в перекладах (${cyrillicSv.length}):`);
  cyrillicSv.forEach((l) => console.error(l));
  errors++;
}

if (missingTCalls.size) {
  console.error(`\n❌ t() виклики з ключами яких нема в uk.ts (${missingTCalls.size}):`);
  let shown = 0;
  for (const [key, files] of missingTCalls) {
    if (shown++ >= 15) { console.error(`   ... і ще ${missingTCalls.size - 15}`); break; }
    console.error(`   "${key}"`);
    files.slice(0, 2).forEach((f) => console.error(`     → ${f}`));
  }
  errors++;
}

if (errors === 0) {
  console.log(`✅ i18n: ${ukKeys.size} ключів, всі синхронізовані між uk/en/sv`);
  process.exit(0);
} else {
  console.error(`\n💥 i18n аудит: ${errors} проблем знайдено`);
  process.exit(1);
}
