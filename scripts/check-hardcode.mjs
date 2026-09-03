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
  // MarketingPage прибрано зі списку 01.09: сторінку локалізовано повністю,
  // тож ховати її від гейта більше нема потреби.
  "LandingPage.tsx", "MarketingUnsubscribePage.tsx",
  "LandingTryDemo.tsx", "LandingFindTutorQuizDialog.tsx",
  "FeedbackPreviewPage.tsx",
  "toasts.ts",
]);

// Max allowed hardcoded strings per file before CI fails
// (some files have intentional ones — dayAffirmations)
// 01.09: стеля була 50 при фактичних 25 — тобто половину боргу можна було
// набрати непомітно. Після локалізації /marketing і /audit ставимо ратчет:
// число може лише падати. Знизив — онови тут.
const MAX_GLOBAL = 3; // 03.09: H1+H2 звели 25→4; коментарі більше не рахуються (03.09) → 4. Ratchet — лише вниз.

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

  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const issues = [];

  /* Аудит 03.09: гейт рахував і КОМЕНТАРІ — чотири з шести «порушень» були
     прозою в /* … *\/ і {/* … *\/}, тобто бюджет витрачався на пояснення, а
     не на рядки, які бачить користувач. Розмічаємо багаторядкові коментарі
     один раз на файл: тепер кожне число в підсумку — справжній UI-рядок.
     Це звуження гейта до суті, а не послаблення: після нього ліміт можна
     тримати нижчим і чесним. */
  const inComment = new Array(lines.length).fill(false);
  {
    let block = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (block) {
        inComment[i] = true;
        if (l.includes("*/")) block = false;
        continue;
      }
      const opens = l.indexOf("/*");
      if (opens !== -1 && !l.includes("*/", opens + 2)) { inComment[i] = true; block = true; }
      else if (opens !== -1) inComment[i] = true;   // однорядковий /* … */
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Skip comments
    if (inComment[i]) continue;
    if (stripped.startsWith("//") || stripped.startsWith("*")) continue;
    // Skip affirmations
    if (line.includes("dayAffirmations")) continue;

    if (!hasCyrillic(line)) continue;

    // H1 (аудит 02.09): наявність t( на рядку ≠ рядок перекладений. Три форми
    // ховали 103 українські рядки від цього гейта:
    //   t("k") || "Укр"                 — || ніколи не спрацьовує (i18next віддає рядок)
    //   t("k", "Укр")                   — другий аргумент = defaultValue
    //   t("k", { defaultValue: "Укр" })
    // Сирий ключ на екрані, якщо переклад відсутній; мертвий хвіст, якщо
    // присутній. Перевіряється НЕЗАЛЕЖНО від умови «UI-рядок у лапках» нижче —
    // саме залежність від неї і робила гейт сліпим.
    const deadFallback =
      /t\(\s*["'][\w.]+["']\s*\)\s*\|\|\s*["'][^"']*[\u0400-\u04FF]{3,}/.test(line) ||
      /t\(\s*["'][\w.]+["']\s*,\s*["'][^"']*[\u0400-\u04FF]{3,}/.test(line) ||
      /t\(\s*["'][\w.]+["']\s*,\s*\{[^}]*defaultValue:\s*["'][^"']*[\u0400-\u04FF]{3,}/.test(line);
    if (deadFallback) {
      issues.push({ line: i + 1, text: "[dead-fallback] " + stripped.slice(0, 64) });
      continue;
    }

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
  if (dashCount > 0) {
    console.log(`   (${dashCount} навмисних афірмацій у DashboardPage не рахуються)`);
  }
  /* Аудит 03.09: у межах ліміту скрипт мовчав про те, ЩО саме лишилось —
     тобто борг був порахований, але невидимий. Друкуємо завжди. */
  for (const [file, issues] of [...results.entries()].filter(([f]) => !f.includes("DashboardPage"))) {
    console.log(`   ▫️ ${file}`);
    issues.forEach(({ line, text }) => console.log(`      ${line}: ${text}`));
  }
  process.exit(0);
}
