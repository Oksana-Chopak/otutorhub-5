#!/usr/bin/env node
/**
 * scripts/check-ux.mjs
 * Ловить UX-регресії які Lovable часто вносить:
 *
 * 1. h-9 на <Input> компонентах (менше 44px мінімуму)
 * 2. text-[10px] або text-[11px] для читабельного контенту
 * 3. TabsList без bg-muted (кнопки вхід/реєстрація не виділені)
 * 4. Відсутній min-h-[44px] на мобільних кнопках (major violations)
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

function getAllFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry)) continue;
      files.push(...getAllFiles(full));
    } else if ([".tsx"].includes(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

const issues = [];

// ── Rule 1: h-9 on Input ─────────────────────────────────────────────────────
// Input h-9 = 36px on mobile — too small. Should be h-10 minimum.
// Exception: inside "hidden sm:..." or "lg:..." wrappers (desktop only)

const INPUT_H9_PATTERN = /<Input[^>]*className=[^>]*\bh-9\b[^>]*>/g;
const SKIP_INPUT_FILES = new Set(["ui/input.tsx"]); // base component itself

for (const file of getAllFiles(SRC)) {
  const fname = file.split("/").pop();
  if (SKIP_INPUT_FILES.has(fname)) continue;
  if (file.includes(".test.")) continue;

  const content = readFileSync(file, "utf8");
  const matches = [...content.matchAll(INPUT_H9_PATTERN)];
  for (const m of matches) {
    const lineNum = content.slice(0, m.index).split("\n").length;
    issues.push({
      rule: "h-9 on Input",
      severity: "error",
      file: file.replace(ROOT, ""),
      line: lineNum,
      detail: "Input has h-9 (36px) — below 44px mobile minimum. Use h-10.",
    });
  }
}

// ── Rule 2: MINIMUM FONT SIZE 13px (accessibility — INVIOLABLE) ─────────────
// Users with ~80% vision, often outdoors in sunlight, must be able to read the
// app. NOTHING readable may be below 13px — whether a Tailwind `text-[Npx]` class
// OR an inline `fontSize:` (this app sizes most text inline, which is exactly how
// tiny fonts kept slipping back in). Hard ERROR, not a warning, so it can't
// regress. See CLAUDE.md "Accessibility — minimum font size (binding ТЗ)".
const FONT_FLOOR = 13;
for (const file of getAllFiles(SRC)) {
  if (file.includes(".test.")) continue;
  const content = readFileSync(file, "utf8");
  let m;
  const reTw = /text-\[(\d+(?:\.\d+)?)px\]/g;
  while ((m = reTw.exec(content))) {
    if (parseFloat(m[1]) < FONT_FLOOR) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      issues.push({
        rule: "font < 13px (a11y floor)",
        severity: "error",
        file: file.replace(ROOT, ""),
        line: lineNum,
        detail: `text-[${m[1]}px] is below the 13px minimum (low vision + sunlight). Use >= 13px.`,
      });
    }
  }
  const reInline = /fontSize:\s*(\d+(?:\.\d+)?)/g;
  while ((m = reInline.exec(content))) {
    if (parseFloat(m[1]) < FONT_FLOOR) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      issues.push({
        rule: "font < 13px (a11y floor)",
        severity: "error",
        file: file.replace(ROOT, ""),
        line: lineNum,
        detail: `fontSize: ${m[1]} is below the 13px minimum (low vision + sunlight). Use >= 13.`,
      });
    }
  }
}

// ── Rule 3: TabsList without bg-muted ────────────────────────────────────────
// Tabs without bg-muted have no visual distinction between active/inactive.

const TABSLIST_PATTERN = /<TabsList(?![^>]*bg-muted)[^>]*>/g;

for (const file of getAllFiles(SRC)) {
  if (file.includes(".test.") || file.includes("/ui/")) continue;
  const content = readFileSync(file, "utf8");
  if (!content.includes("TabsList")) continue;

  const matches = [...content.matchAll(TABSLIST_PATTERN)];
  for (const m of matches) {
    const lineNum = content.slice(0, m.index).split("\n").length;
    issues.push({
      rule: "TabsList without bg-muted",
      severity: "warning",
      file: file.replace(ROOT, ""),
      line: lineNum,
      detail: "TabsList missing bg-muted — active/inactive tabs look identical.",
    });
  }
}

// ── Rule 4: Select/Button with h-8 in non-desktop contexts ─────────────────
// h-8 = 32px — way below minimum. OK only inside sm:hidden wrappers.

const H8_PATTERN = /className=[^>]*\bh-8\b[^>]*/g;
const H8_COMPONENT_PATTERN = /<(Button|SelectTrigger)[^>]*h-8[^>]*/g;

for (const file of getAllFiles(SRC)) {
  if (file.includes(".test.") || file.includes("/ui/")) continue;
  const content = readFileSync(file, "utf8");

  const matches = [...content.matchAll(H8_COMPONENT_PATTERN)];
  for (const m of matches) {
    // Check if inside a sm:hidden or hidden sm:flex wrapper (context check)
    const before = content.slice(Math.max(0, m.index - 200), m.index);
    const isDesktopOnly = before.includes("hidden sm:") || before.includes("sm:hidden");

    if (!isDesktopOnly) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      issues.push({
        rule: "h-8 Button/SelectTrigger",
        severity: "warning",
        file: file.replace(ROOT, ""),
        line: lineNum,
        detail: "Interactive element has h-8 (32px) — too small for mobile tapping.",
      });
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");

if (errors.length > 0) {
  console.error(`\n❌ UX помилки (${errors.length}):`);
  for (const issue of errors) {
    console.error(`  [${issue.rule}] ${issue.file}:${issue.line}`);
    console.error(`    ${issue.detail}`);
  }
}

if (warnings.length > 0) {
  const WARN_LIMIT = 115; // BASELINE: current count is ~103. Decrease by 10 per sprint.
  if (warnings.length > WARN_LIMIT) {
    console.error(`\n⚠️  UX попередження: ${warnings.length} (ліміт: ${WARN_LIMIT})`);
    warnings.slice(0, 8).forEach((w) => {
      console.error(`  [${w.rule}] ${w.file}:${w.line}`);
    });
    if (warnings.length > 8) console.error(`  ... і ще ${warnings.length - 8}`);
  } else {
    console.log(`⚠️  UX попередження: ${warnings.length}/${WARN_LIMIT} — OK`);
  }
}

const FINAL_WARN_LIMIT = 115;
if (errors.length > 0 || warnings.length > FINAL_WARN_LIMIT) {
  console.error(`\n💥 UX аудит не пройдено: ${errors.length} помилок, ${warnings.length}/${FINAL_WARN_LIMIT} попереджень`);
  process.exit(1);
} else {
  console.log(`✅ UX аудит пройдено: ${errors.length} помилок, ${warnings.length}/${FINAL_WARN_LIMIT} попереджень`);
  process.exit(0);
}
