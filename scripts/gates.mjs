#!/usr/bin/env node
/**
 * gates — ОДИН ланцюг воріт для агента і для CI (22.09, «Сторож»).
 *
 * Чому один: до 22.09 CI і «обовʼязковий ланцюг» з HANDOFF були двома різними
 * списками, і CI (а) чотири тижні був мертвий через дубльований ключ у YAML,
 * (б) навіть живий — перевіряв `npx tsc --noEmit` (тобто нічого) і не знав про
 * пів списку. Тепер CI виконує рівно цей файл; агент перед комітом — теж.
 * Список воріт у двох місцях не існує, тому розійтись їм нема як.
 *
 *   node scripts/gates.mjs              → усе (потрібен Postgres для db-replay)
 *   node scripts/gates.mjs --no-db      → усе, крім прогону бази (локально, коли Postgres немає — тоді
 *                                         ворота НЕ зелені, а «жовті», і про це сказано словами)
 *   node scripts/gates.mjs --only=a,b   → лише названі ворота (для швидкої ітерації)
 *   node scripts/gates.mjs --fail-fast  → зупинитись на першому провалі
 *
 * Postgres: PGHOST/PGPORT/PGUSER/PGPASSWORD як у psql; локально — scripts/db-replay/local-pg.sh.
 * Кожні ворота — окремий процес із власним кодом виходу; grep-присутність не рахується.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const NO_DB = args.includes("--no-db");
const FAIL_FAST = args.includes("--fail-fast");
const ONLY = (args.find((a) => a.startsWith("--only="))?.slice(7) ?? "").split(",").filter(Boolean);
const IS_CI = !!process.env.CI;

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0", ...(opts.env ?? {}) }, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status };
}

// ── Ворота (порядок = порядок виконання; кожні мають назву, команду і «чому») ──
const GATES = [
  {
    name: "workflows",
    why: "YAML воркфлоу валідний — дубльований ключ 25.08 убив увесь CI на 287 комітів",
    fn: () => {
      const yaml = require("js-yaml");
      const dir = join(ROOT, ".github", "workflows");
      const bad = [];
      for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
        try {
          const doc = yaml.load(readFileSync(join(dir, f), "utf8"));
          if (!doc || typeof doc !== "object" || !doc.jobs) bad.push(`${f}: немає jobs`);
        } catch (e) {
          bad.push(`${f}: ${String(e.message).split("\n")[0]}`);
        }
      }
      return { ok: bad.length === 0, out: bad.length ? bad.join("\n") : "усі воркфлоу читаються" };
    },
  },
  { name: "typecheck", why: "tsc -p tsconfig.app.json; НЕ npx tsc --noEmit (той перевіряє нічого)", cmd: [npm, ["run", "-s", "typecheck"]] },
  { name: "eslint", why: "0 помилок у src", cmd: [npx, ["eslint", "src", "--quiet"]] },
  { name: "vitest", why: "усі модульні тести й ратчети", cmd: [npx, ["vitest", "run", "--reporter=dot"]] },
  { name: "build", why: "vite build — esbuild ловить те, що tsc і vitest пропускають", cmd: [npm, ["run", "-s", "build"]] },
  { name: "i18n", why: "uk/en/sv синхронні, без сирих ключів", cmd: [process.execPath, ["scripts/check-i18n.mjs"]] },
  { name: "ux", why: "шрифт ≥13px, цілі дотику ≥44px", cmd: [process.execPath, ["scripts/check-ux.mjs"]] },
  { name: "hardcode", why: "вшитий український текст ≤ стелі", cmd: [process.execPath, ["scripts/check-hardcode.mjs"]] },
  { name: "currency", why: "0 літеральних валют", cmd: [process.execPath, ["scripts/check-currency.mjs"]] },
  { name: "db-sync", why: "міграції нижче водяного знаку Lovable = 0", cmd: [process.execPath, ["scripts/check-db-sync.mjs"]] },
  { name: "db-select", why: "кожен select/rpc — лише колонки й функції з types.ts", cmd: [process.execPath, ["scripts/check-db-select.mjs"]] },
  { name: "stamp-edge", why: "_shared/version.ts відповідає джерелам edge-функцій", cmd: [process.execPath, ["scripts/stamp-edge.mjs", "--check"]] },
  {
    name: "esbuild-edge",
    why: "КОЖНА edge-функція збирається (не лише «зачеплені»)",
    fn: () => {
      const dir = join(ROOT, "supabase", "functions");
      const fns = readdirSync(dir).filter((d) => !d.startsWith("_") && statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, "index.ts")));
      const bad = [];
      for (const f of fns) {
        const r = run(npx, ["esbuild", `supabase/functions/${f}/index.ts`, "--format=esm", "--outfile=/dev/null", "--log-level=warning"]);
        if (!r.ok) bad.push(`${f}:\n${r.out.trim()}`);
      }
      return { ok: bad.length === 0, out: bad.length ? bad.join("\n") : `${fns.length} функцій збираються` };
    },
  },
  {
    name: "playwright-list",
    why: "обидва конфіги Playwright читаються (tsc їх не бачить)",
    fn: () => {
      const a = run(npx, ["playwright", "test", "--list"]);
      const b = run(npx, ["playwright", "test", "-c", "playwright.prod.config.ts", "--list"]);
      return { ok: a.ok && b.ok, out: (a.ok ? "e2e ok" : a.out) + "\n" + (b.ok ? "prod ok" : b.out) };
    },
  },
  {
    name: "db-replay",
    why: "уся історія міграцій прогоняється на чистому Postgres; схема = types.ts; onConflict = унікальні ключі; сценарії тригерів",
    db: true,
    cmd: [process.execPath, ["scripts/db-replay/replay.mjs"]],
  },
];

function pgReachable() {
  const r = spawnSync("psql", ["-X", "-At", "-h", process.env.PGHOST ?? "/tmp", "-p", process.env.PGPORT ?? "5432", "-U", process.env.PGUSER ?? "postgres", "-d", "postgres", "-c", "select 1"], { encoding: "utf8", env: process.env });
  return r.status === 0;
}

const t0 = Date.now();
const results = [];
let anyFail = false;
for (const g of GATES) {
  if (ONLY.length && !ONLY.includes(g.name)) continue;
  if (g.db && NO_DB) {
    results.push({ name: g.name, state: "skip", secs: 0, out: "пропущено (--no-db)" });
    continue;
  }
  if (g.db && !pgReachable()) {
    const out = "Postgres недосяжний. Локально: bash scripts/db-replay/local-pg.sh; або --no-db (тоді ворота не зелені, а жовті).";
    results.push({ name: g.name, state: IS_CI ? "fail" : "nodb", secs: 0, out });
    if (IS_CI) anyFail = true;
    continue;
  }
  const s = Date.now();
  const r = g.fn ? g.fn() : run(g.cmd[0], g.cmd[1]);
  const secs = ((Date.now() - s) / 1000).toFixed(0);
  results.push({ name: g.name, state: r.ok ? "ok" : "fail", secs, out: r.out });
  process.stdout.write(`${r.ok ? "✅" : "❌"} ${g.name.padEnd(16)} ${String(secs).padStart(4)}s  ${g.why}\n`);
  if (!r.ok) {
    anyFail = true;
    const tail = String(r.out).trim().split("\n").slice(-40).join("\n");
    process.stdout.write(tail.replace(/^/gm, "     ") + "\n");
    if (FAIL_FAST) break;
  }
}

const total = ((Date.now() - t0) / 1000).toFixed(0);
const failed = results.filter((r) => r.state === "fail").map((r) => r.name);
const yellow = results.filter((r) => r.state === "nodb" || r.state === "skip").map((r) => r.name);
console.log("");
if (anyFail) {
  console.log(`⛔ ВОРОТА ЧЕРВОНІ (${total}s): впало — ${failed.join(", ")}. Не комітити, не пушити, не публікувати.`);
  process.exit(1);
}
if (yellow.length) {
  console.log(`🟡 ВОРОТА ЖОВТІ (${total}s): усе зелене, крім ${yellow.join(", ")} — базу не прогнано. У CI це буде прогнано; локально запусти Postgres, якщо міняв міграції чи запити.`);
  process.exit(0);
}
console.log(`🟢 ВОРОТА ЗЕЛЕНІ (${total}s): ${results.length} воріт пройдено.`);
