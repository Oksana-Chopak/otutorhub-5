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
    } else if ([".tsx", ".css"].includes(extname(entry))) {
      // .css included so sub-13px fonts hidden inside @apply utility classes
      // (e.g. `.gamify-sticker { @apply ... text-xs ... }`) can't slip past the
      // gate — that was a blind spot: components using the class passed green.
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
  // NAMED Tailwind classes below the floor. text-xs = 12px (< 13). text-sm = 14px (OK).
  // This was the BLIND SPOT: the regexes above only catch text-[Npx] + inline fontSize,
  // so text-xs slipped through repeatedly. Treat any sub-floor named size as an error.
  const reNamed = /\btext-xs\b/g; // 12px; add other sub-13 named sizes here if introduced
  while ((m = reNamed.exec(content))) {
    const lineNum = content.slice(0, m.index).split("\n").length;
    issues.push({
      rule: "font < 13px (a11y floor)",
      severity: "error",
      file: file.replace(ROOT, ""),
      line: lineNum,
      detail: `text-xs is 12px, below the 13px minimum (low vision + sunlight). Use text-[13px] or larger.`,
    });
  }
}

// ── Rule 3: TabsList with no active/inactive distinction ─────────────────────
// The shadcn base <TabsList> already ships `bg-muted`, so a bare TabsList (or one that
// only adds layout classes like `grid w-full`) inherits the muted fill and is fine.
// Only flag a TabsList that OVERRIDES the fill to a flat/transparent bg AND has no
// underline border as an alternative active cue — the genuinely indistinct case. (The
// old literal-`bg-muted` check flagged every styled TabsList and produced only false
// positives: underline-style Finances tabs, inline-bg Auth tabs, plain grid tabs.)

const TABSLIST_PATTERN = /<TabsList\b[^>]*>/g;
const FLAT_TABS_BG = /bg-(transparent|white|background|card)\b/;

for (const file of getAllFiles(SRC)) {
  if (file.includes(".test.") || file.includes("/ui/")) continue;
  const content = readFileSync(file, "utf8");
  if (!content.includes("TabsList")) continue;

  for (const m of content.matchAll(TABSLIST_PATTERN)) {
    const tag = m[0];
    if (FLAT_TABS_BG.test(tag) && !/\bborder/.test(tag)) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      issues.push({
        rule: "TabsList without visual distinction",
        severity: "warning",
        file: file.replace(ROOT, ""),
        line: lineNum,
        detail: "TabsList overrides the base bg-muted to a flat bg with no underline border — active/inactive look identical.",
      });
    }
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

// ── Rule 5: forms must be bottom-sheets (no old centered dialogs creeping back) ──
// Every <DialogContent> should use the bottom-sheet pattern (rounded-t-[…] + bottom-0
// + sm:translate-y-[-50%]). A plain centered DialogContent is exactly the "old form"
// that kept reappearing across roles. AlertDialogContent (confirmations) is NOT matched
// — only <DialogContent>. Allowlist genuinely non-form dialogs (image lightbox, the
// marketing landing quiz) by filename.
const DIALOG_CONTENT_PATTERN = /<DialogContent\b[^>]*>/g;
const FORM_SHEET_ALLOW = new Set([
  "ChatAttachment.tsx",              // image lightbox — a centered viewer is correct
  "LandingFindTutorQuizDialog.tsx",  // marketing landing page, its own design language
]);

for (const file of getAllFiles(SRC)) {
  if (file.includes(".test.") || file.includes("/ui/")) continue;
  const fname = file.split("/").pop();
  if (FORM_SHEET_ALLOW.has(fname)) continue;

  const content = readFileSync(file, "utf8");
  if (!content.includes("<DialogContent")) continue;

  for (const m of content.matchAll(DIALOG_CONTENT_PATTERN)) {
    const tag = m[0];
    const isBottomSheet = tag.includes("rounded-t-[") || tag.includes("bottom-0");
    if (!isBottomSheet) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      issues.push({
        rule: "form not a bottom-sheet",
        severity: "error",
        file: file.replace(ROOT, ""),
        line: lineNum,
        detail:
          "Centered (old-style) DialogContent. Use the bottom-sheet pattern " +
          "(rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 " +
          "sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto), or add the file to " +
          "FORM_SHEET_ALLOW in check-ux.mjs if it is intentionally a centered viewer.",
      });
    }
  }
}

// ── Rule 6: base UI controls must keep a 44px touch target on every breakpoint ──
// Button/Input/Select are touch-first. Re-introducing md:h-9 / md:h-10 shrinks every
// control to 36/40px on desktop — the recurring "small elements, lots of empty space"
// regression. Hard error so a shadcn re-sync can't silently bring it back.
const TOUCH_BASE_FILES = ["button.tsx", "input.tsx", "select.tsx"];
for (const file of getAllFiles(SRC)) {
  const fname = file.split("/").pop();
  if (!file.includes("/ui/") || !TOUCH_BASE_FILES.includes(fname)) continue;
  const content = readFileSync(file, "utf8");
  const m = content.match(/md:h-(8|9|10)\b/);
  if (m) {
    const lineNum = content.slice(0, content.indexOf(m[0])).split("\n").length;
    issues.push({
      rule: "base control downsized on desktop",
      severity: "error",
      file: file.replace(ROOT, ""),
      line: lineNum,
      detail: `${fname} uses ${m[0]} — base Button/Input/Select must stay h-11 (44px) on all breakpoints. Remove the md: height override.`,
    });
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
