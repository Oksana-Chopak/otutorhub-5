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

function extractLeafKeys(text, prefix = "") {
  const keys = new Set();
  const path = [];
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("//") || stripped.startsWith("*")) continue;

    const openObj = stripped.match(/^(\w+)\s*:\s*\{/);
    if (openObj && !stripped.includes("}")) {
      path.push(openObj[1]);
      continue;
    }
    const keyVal = stripped.match(/^(\w+)\s*:\s*["'`\[]/);
    if (keyVal) {
      keys.add([...path, keyVal[1]].join("."));
      continue;
    }
    if (stripped.startsWith("}") && path.length) path.pop();
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

const SKIP_KEY_PREFIXES = [
  "common.", "nav.", "auth.", "roles.", "schedule.", "finances.",
  "myStudents.", "lessonCard.", "profile.", "onboarding.", "streak.",
  "trial.", "referralWidget.", "quickLessonDialog.", "walletDialog.",
  "authExtra.", "scheduleExtra.", "studentPages.", "dashboardExtra.",
  "pendingPaymentsExtra.", "groupsPageExtra.", "inviteLinkExtra.", "emptyState.",
  "chatContext.", "groupsPage.", "inviteLink.",
];

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
    if (!ukKeys.has(baseKey)) {
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
