#!/usr/bin/env node
/**
 * scripts/check-hardcode.mjs
 * Знаходить хардкодовані рядки українською в TSX/TS файлах
 * що не використовують t() — тобто не перекладаються.
 *
 * Допустимі винятки:
 * - dayAffirmations масив (навмисно українські)
 * - PrivacyPage, TermsPage (юридичні документи)
 * - LandingPage (окремий переклад)
 * - i18n/locales/ (самі файли перекладів)
 * - .test. файли
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const SKIP_FILES = new Set([
  "PrivacyPage.tsx", "TermsPage.tsx", "mock-data.ts",
  "LandingPage.tsx", "MarketingPage.tsx", "MarketingUnsubscribePage.tsx",
  "LandingTryDemo.tsx", "LandingFindTutorQuizDialog.tsx",
  "FeedbackPreviewPage.tsx",
]);

// Max allowed hardcoded strings per file before CI fails
// (some files have intentional ones — dayAffirmations)
const MAX_GLOBAL = 60; // BASELINE: ~50 real hardcoded strings. Decrease each sprint.

function getAllFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry)) continue;
      files.push(...getAllFiles(full));
    } else if ([".tsx", ".ts"].includes(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

function hasCyrillic(s) {
  return /[\u0400-\u04FF]{3,}/.test(s);
}

const results = new Map(); // file → issues[]

for (const file of getAllFiles(SRC)) {
  const fname = file.split("/").pop();
  if (SKIP_FILES.has(fname)) continue;
  if (file.includes("/i18n/")) continue;
  if (file.includes(".test.")) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Skip comments
    if (stripped.startsWith("//") || stripped.startsWith("*")) continue;
    // Skip affirmations
    if (line.includes("dayAffirmations")) continue;

    if (!hasCyrillic(line)) continue;

    // Check if it's a UI string not wrapped in t()
    if (/["'`>].*[\u0400-\u04FF]{3,}.*["'`<]/.test(line)) {
      if (!/\bt\(/.test(line)) {
        issues.push({ line: i + 1, text: stripped.slice(0, 80) });
      }
    }
  }

  if (issues.length > 0) {
    results.set(file.replace(ROOT, ""), issues);
  }
}

const total = [...results.values()].reduce((s, v) => s + v.length, 0);

// Separate DashboardPage (has affirmations — expected)
const dashCount = results.get("src/pages/DashboardPage.tsx")?.length ?? 0;
const realTotal = total - dashCount;

if (realTotal > MAX_GLOBAL) {
  console.error(`\n❌ Хардкодовані рядки поза t(): ${realTotal} (ліміт: ${MAX_GLOBAL})`);
  console.error(`   (DashboardPage виключено — ${dashCount} рядків навмисних афірмацій)\n`);

  for (const [file, issues] of [...results.entries()]
    .filter(([f]) => !f.includes("DashboardPage"))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)) {
    console.error(`  📄 ${file} (${issues.length}):`);
    issues.slice(0, 3).forEach(({ line, text }) =>
      console.error(`    ${line}: ${text}`)
    );
    if (issues.length > 3) console.error(`    ... і ще ${issues.length - 3}`);
  }

  process.exit(1);
} else {
  console.log(
    `✅ Хардкод: ${realTotal} рядків (ліміт ${MAX_GLOBAL}) — в нормі`
  );
  if (realTotal > 0) {
    console.log(`   (${dashCount} навмисних афірмацій у DashboardPage не рахуються)`);
  }
  process.exit(0);
}
