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

// ── Rule 2: text-[10px] or text-[11px] in readable content ──────────────────
// These sizes are unreadable on mobile. Only text-xs (12px) minimum.
// Exception: known badge/chip contexts are OK — but content sentences are not.

const TINY_TEXT_PATTERN = /className=[^>]*text-\[1[01]px\][^>]*/g;
const TINY_TEXT_SKIP = new Set([
  // Known acceptable tiny text files
]);

for (const file of getAllFiles(SRC)) {
  if (file.includes(".test.")) continue;
  const content = readFileSync(file, "utf8");
  const matches = [...content.matchAll(TINY_TEXT_PATTERN)];
  for (const m of matches) {
    // Skip if it's on a div that's clearly a badge (contains "rounded-full" and short content)
    const ctx = content.slice(Math.max(0, m.index - 50), m.index + 100);
    const isBadge = ctx.includes("rounded-full") && !ctx.includes("font-normal");

    if (!isBadge) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      issues.push({
        rule: "text-[10px]/text-[11px]",
        severity: "warning",
        file: file.replace(ROOT, ""),
        line: lineNum,
        detail: `Tiny text found: ${m[0].slice(0, 60)}. Min readable size is text-xs (12px).`,
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
  const WARN_LIMIT = 110; // BASELINE: current count is ~103. Decrease by 10 per sprint.
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

if (errors.length > 0 || warnings.length > 15) {
  console.error(`\n💥 UX аудит не пройдено`);
  process.exit(1);
} else {
  console.log(`✅ UX аудит пройдено: ${errors.length} помилок, ${warnings.length} попереджень`);
  process.exit(0);
}
