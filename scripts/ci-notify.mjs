#!/usr/bin/env node
/**
 * ci-notify — один зрозумілий рядок для власниці з результатів CI (22.09, «Сторож»).
 *
 * Збирає вердикт воріт (gates) і робота на проді (prod-report.json від Playwright)
 * у коротке повідомлення для Telegram (HTML) і пише його в ci-message.txt;
 * воркфлоу шле файл в edge-функцію `ci-report`. Логіка тут, а не в bash, щоб її
 * можна було запустити й перевірити локально:
 *
 *   GATES_RESULT=success EVENT=push SHA=abc1234 TITLE="…" RUN_URL=… node scripts/ci-notify.mjs
 *
 * Правила формулювань — рішення 22.09: вердикт першим словом (🟢/🔴/🌅), далі
 * що саме впало, далі ЩО РОБИТИ (Publish · передеплой · скинути агентові), без
 * жаргону і без даних користувачів.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const env = process.env;
const gates = env.GATES_RESULT ?? "skipped"; // success | failure | cancelled | skipped
const event = env.EVENT ?? "push"; // push | schedule | workflow_dispatch | pull_request
const sha = (env.SHA ?? "").slice(0, 7);
const title = (env.TITLE ?? "").split("\n")[0].slice(0, 70);
const runUrl = env.RUN_URL ?? "";
const gatesTail = env.GATES_TAIL_FILE && existsSync(env.GATES_TAIL_FILE) ? readFileSync(env.GATES_TAIL_FILE, "utf8") : "";
const reportFile = env.PROD_REPORT ?? "prod-report.json";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const stripAnsi = (s) => String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");

// ── Ворота ────────────────────────────────────────────────────────────────────
const failedGates = [...gatesTail.matchAll(/^❌ ([a-z-]+)/gm)].map((m) => m[1]);
const gatesLine =
  gates === "success" ? "✅ ворота пройдено" :
  gates === "failure" ? `❌ ворота впали: <b>${esc(failedGates.join(", ") || "див. журнал")}</b>` :
  gates === "skipped" ? "" : `⚠️ ворота: ${esc(gates)}`;

// ── Прод ──────────────────────────────────────────────────────────────────────
function flatten(suite, acc = []) {
  for (const s of suite.suites ?? []) flatten(s, acc);
  for (const spec of suite.specs ?? []) acc.push(spec);
  return acc;
}
const prod = { ran: false, ok: [], failed: [], skipped: [], notes: [], stale: [] };
if (existsSync(reportFile)) {
  try {
    const rep = JSON.parse(readFileSync(reportFile, "utf8"));
    prod.ran = true;
    for (const spec of flatten({ suites: rep.suites ?? [] })) {
      const t = spec.tests?.[0];
      if (!t) continue;
      const last = t.results?.[t.results.length - 1];
      for (const a of t.annotations ?? []) {
        if (a.type === "freshness") prod.notes.push(a.description);
        if (a.type === "stale") prod.stale.push(a.description);
      }
      if (t.status === "skipped") prod.skipped.push(spec.title);
      else if (t.status === "expected" || t.status === "flaky") prod.ok.push(spec.title);
      else {
        // Перший рядок — що впало; наступні до 5 — діагностика робота (адреса, екран,
        // збійні запити). Без них власниця й агент бачили лише «видно «Не вдалося
        // завантажити»», а причина жила в закритому журналі GitHub (23.09).
        const raw = stripAnsi(last?.error?.message ?? last?.errors?.[0]?.message ?? "")
          .split("\n").map((l) => l.trim()).filter((l) => l && !/^(Call log|- |at |expect\()/i.test(l));
        const head = (raw[0] ?? "").slice(0, 200);
        const details = raw.slice(1, 6).map((l) => l.slice(0, 200));
        prod.failed.push({ title: spec.title, head, details });
      }
    }
  } catch (e) {
    prod.notes.push(`звіт робота не прочитався: ${e.message}`);
  }
}

// ── Текст ─────────────────────────────────────────────────────────────────────
const lines = [];
const gatesRed = gates === "failure";
const prodRed = prod.failed.length > 0;
const red = gatesRed || prodRed;
const where = sha ? `<code>${esc(sha)}</code>${title ? ` «${esc(title)}»` : ""}` : "";

if (event === "schedule") {
  lines.push(red ? `🌅 <b>Прод уранці: є проблеми</b>` : `🌅 <b>Прод уранці: усе гаразд</b>`);
} else if (event === "workflow_dispatch") {
  lines.push(red ? `🔎 <b>Перевірка вручну: є проблеми</b>` : `🔎 <b>Перевірка вручну: усе гаразд</b>`);
} else if (gatesRed) {
  // Червоний = код у main не пройшов ворота. Це єдиний випадок «не публікуй».
  lines.push(`🔴 <b>main червоний</b> ${where}`);
} else if (prodRed) {
  // Ворота зелені, а на ЖИВОМУ проді робот побачив збій: не про цей пуш, а про те,
  // що зараз бачать люди. 23.09 це йшло під 🔴 і читалось як «пуш зламав» — ні.
  lines.push(`🟠 <b>main зелений, але на проді є збій</b> ${where}`);
} else {
  lines.push(`🟢 <b>main зелений</b> ${where}`);
}
if (gatesLine) lines.push(gatesLine);

if (prod.ran) {
  if (prod.failed.length) {
    lines.push(`❌ прод: ${prod.failed.length} збій(-ї)`);
    for (const f of prod.failed) {
      lines.push(`   • <b>${esc(f.title)}</b> — ${esc(f.head)}`);
      for (const d of f.details) lines.push(`      ${esc(d)}`);
    }
  } else {
    lines.push(`✅ прод живий: ${prod.ok.length} перевірок${prod.skipped.length ? `, пропущено ${prod.skipped.length} (немає тестових акаунтів)` : ""}`);
  }
  for (const s of prod.stale) lines.push(`⚠️ ${esc(s)}`);
  for (const n of prod.notes) lines.push(`ℹ️ ${esc(n)}`);
}

// Що робити — одним рядком
if (gatesRed) {
  lines.push(`\n⛔ <b>НЕ публікуй.</b> Скинь це повідомлення агентові — він знайде причину в журналі.`);
} else if (event === "push") {
  const todo = [];
  const all = [...prod.stale, ...prod.notes];
  if (!prod.ran || all.some((s) => /Publish|без \/version\.json/.test(s))) todo.push("Publish у Lovable");
  // «не перевірити» (захищена JWT) — не привід до передеплою; лише справжнє «застаріло»
  if (prod.stale.some((s) => /edge|передеплой|не задеплоєна/i.test(s))) todo.push("«Передеплой усі edge-функції» у чаті Lovable");
  const step = todo.length ? "Можна: " + todo.join(" → ") : "Прод уже на цій версії — робити нічого не треба";
  lines.push(prodRed
    ? `\n👉 ${step}. Збій на проді — скинь це повідомлення агентові: діагностика вже в ньому.`
    : `\n👉 ${step}.`);
} else if (prodRed) {
  lines.push(`\n👉 Скинь це повідомлення агентові — діагностика вже в ньому.`);
}
if (runUrl) lines.push(`<a href="${esc(runUrl)}">журнал запуску</a>`);

const text = lines.join("\n");
writeFileSync("ci-message.txt", text);
console.log(text);
