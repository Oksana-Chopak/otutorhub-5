#!/usr/bin/env node
/**
 * ux-census — «що бачить людина, щойно відкрила екран» (15.11).
 *
 * every-button питає «чи працює кожна кнопка». Тут інше питання — скільки екран вимагає
 * від людини думати: скільки варіантів вибору видно одразу, чи є ОДНА головна дія, чи
 * підказує екран наступний крок, наскільки довго гортати. Знімок 390×844 кожного екрана
 * кожної ролі + цифри для матриці взаємодій.
 *
 *   node scripts/local-stack/ux-census.mjs        (стенд піднятий, проходи створили людей)
 * Звіт: $UX_OUT/<роль>.json + знімки $UX_OUT/<роль>__<маршрут>.png
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : await import("playwright");
const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const OUT = process.env.UX_OUT ?? "/tmp/ux-census";
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => spawnSync("psql", ["-X", "-q", "-At", "-d", process.env.STACK_DB ?? "stackdb", "-c", q], {
  encoding: "utf8", env: { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" },
}).stdout.trim();
const latest = (prefix, domain) => psql(`select email from auth.users where email like '${prefix}-%@${domain}' order by created_at desc limit 1`);
const PEOPLE = {
  manager: latest("maria", "lingua.test"),
  hubtutor: latest("iryna", "lingua.test"),
  student: latest("solomiia", "fam.test"),
  independent: latest("alina", "tutor.test"),
  superadmin: latest("oksana", "platform.test"),
};
const ROUTES = {
  manager: ["/dashboard", "/schedule", "/people", "/people?tab=students", "/groups", "/chats", "/finances", "/finances?tab=debts", "/wallets", "/referrals", "/availability", "/profile"],
  hubtutor: ["/dashboard", "/schedule", "/groups", "/chats", "/finances", "/availability", "/achievements", "/profile"],
  student: ["/student-dashboard", "/student/schedule", "/student/payments", "/student/homework", "/student/achievements", "/student/profile", "/chats"],
  independent: ["/dashboard", "/schedule", "/my-students", "/groups", "/chats", "/finances", "/finances?tab=debts", "/wallets", "/availability", "/achievements", "/my-referrals", "/profile", "/subscription"],
  superadmin: ["/dashboard", "/admin", "/errors", "/feedback-inbox", "/subscription-requests", "/paywall-metrics"],
  guest: ["/", "/auth", "/auth?signup=1", "/for-students"],
};
const only = process.env.UX_ONLY?.split(",");

async function census(role) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "uk-UA", timezoneId: "Europe/Kyiv" });
  await ctx.route(/clarity\.ms|facebook\.(com|net)|fbevents|google-analytics|googletagmanager|doubleclick/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "uk"); localStorage.setItem("otutorhub_cookie_consent", "declined"); } catch { /* */ } });
  const page = await ctx.newPage();
  if (role !== "guest") {
    const email = PEOPLE[role];
    if (!email) { console.log(`— ${role}: людини немає, пропускаю`); await browser.close(); return []; }
    const r = await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "x" }) });
    const s = await r.json();
    await page.goto(BASE + "/terms");
    await page.evaluate((v) => localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)), s);
  }
  const rows = [];
  for (const route of ROUTES[role]) {
    await page.goto(BASE + route); await wait(4500);
    await page.getByRole("button", { name: "Прийняти" }).click({ timeout: 800 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await wait(400);
    const finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    const data = await page.evaluate(() => {
      const SEL = "button, a[href], [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], input:not([type=hidden]), select, textarea, summary";
      const vh = innerHeight;
      const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        return r.width > 4 && r.height > 4 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
      const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || el.value || "").trim().replace(/\s+/g, " ").slice(0, 60);
      const all = [...document.querySelectorAll(SEL)].filter(visible);
      // навігація (нижня панель / бокове меню) — окремо: вона однакова на всіх екранах
      const isNav = (el) => !!el.closest("nav, [data-bottom-nav], aside, header");
      const content = all.filter((el) => !isNav(el));
      const above = content.filter((el) => el.getBoundingClientRect().top < vh && el.getBoundingClientRect().bottom > 0);
      // «головна» кнопка: залита брендовим кольором (не прозора, не біла, не сіра)
      const filled = (el) => { const bg = getComputedStyle(el).backgroundColor; const m = bg.match(/\d+(\.\d+)?/g); if (!m) return false;
        const [r, g, b, a = 1] = m.map(Number); if (a < 0.5) return false;
        const sat = Math.max(r, g, b) - Math.min(r, g, b); return sat > 60; };
      const primaries = above.filter((el) => (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.tagName === "A") && filled(el));
      const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).map((h) => h.innerText.trim().slice(0, 60)).filter(Boolean);
      const inputs = above.filter((el) => /INPUT|SELECT|TEXTAREA/.test(el.tagName));
      return {
        height: document.documentElement.scrollHeight, vh,
        controlsAll: content.length, controlsAbove: above.length, navControls: all.length - content.length,
        primariesAbove: primaries.map(label), inputsAbove: inputs.length,
        headings: headings.slice(0, 12),
        labelsAbove: above.map(label).filter(Boolean).slice(0, 40),
        text: document.body.innerText.slice(0, 1500),
      };
    });
    const safe = route.replace(/[/?=&]+/g, "_").replace(/^_/, "") || "root";
    await page.screenshot({ path: `${OUT}/${role}__${safe}.png` });
    rows.push({ role, route, finalUrl, screens: +(data.height / data.vh).toFixed(1), ...data });
    console.log(`■ ${role} ${route}${finalUrl !== route ? " → " + finalUrl : ""}: видно одразу ${data.controlsAbove} · усього ${data.controlsAll} · головних ${data.primariesAbove.length} · екранів гортання ${(data.height / data.vh).toFixed(1)}`);
  }
  writeFileSync(`${OUT}/${role}.json`, JSON.stringify(rows, null, 1));
  await browser.close();
  return rows;
}

for (const role of Object.keys(ROUTES)) {
  if (only && !only.includes(role)) continue;
  await census(role);
}
console.log("готово");
