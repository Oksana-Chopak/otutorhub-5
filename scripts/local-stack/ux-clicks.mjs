#!/usr/bin/env node
/**
 * ux-clicks — «натиснути кожну кнопку першого рівня і записати, що сталося» (15.11).
 *
 * Легший брат every-button: лише перший рівень, з жорсткими лімітами часу на дотик і на
 * екран, щоб прохід завершувався на слабкій машині. Для матриці взаємодій:
 * екран × елемент → куди привело / що відкрилось / що сказало / нічого (мертвий).
 *   node scripts/local-stack/ux-clicks.mjs        UX_ONLY=manager  UX_OUT=…
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : await import("playwright");
const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const OUT = process.env.UX_OUT ?? "/tmp/ux-clicks";
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => spawnSync("psql", ["-X", "-q", "-At", "-d", process.env.STACK_DB ?? "stackdb", "-c", q], {
  encoding: "utf8", env: { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" },
}).stdout.trim();
const latest = (prefix, domain) => psql(`select email from auth.users where email like '${prefix}-%@${domain}' order by created_at desc limit 1`);
const PEOPLE = {
  manager: latest("maria", "lingua.test"), hubtutor: latest("iryna", "lingua.test"),
  student: latest("solomiia", "fam.test"), independent: latest("alina", "tutor.test"),
  superadmin: latest("oksana", "platform.test"),
};
const ROUTES = {
  manager: ["/dashboard", "/schedule", "/people", "/people?tab=students", "/groups", "/chats", "/finances", "/finances?tab=debts", "/wallets", "/availability", "/profile"],
  hubtutor: ["/dashboard", "/schedule", "/groups", "/chats", "/finances", "/availability", "/profile"],
  independent: ["/dashboard", "/schedule", "/my-students", "/groups", "/chats", "/finances", "/finances?tab=debts", "/wallets", "/availability", "/profile", "/subscription"],
  superadmin: ["/dashboard", "/admin", "/errors", "/feedback-inbox", "/subscription-requests", "/paywall-metrics"],
  student: ["/student-dashboard", "/student/schedule", "/student/payments", "/student/homework", "/student/profile", "/chats"],
};
const SKIP = /^(Вийти|Вийти з акаунта)$|Видалити|видалити|Архів|Google|LiqPay|Перейти до оплати|Оплатити карткою|Скинути|Очистити все|Перемкнути тему|Мова інтерфейсу|Політика|Договір|Написати в підтримку|Залишити фідбек/;
const SEL = "button, a[href], [role=button], [role=tab], [role=switch], [role=checkbox]";
const only = process.env.UX_ONLY?.split(",");
const PER_ROUTE_MS = Number(process.env.UX_ROUTE_MS ?? 240000);

async function login(page, email) {
  const r = await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "x" }) });
  const s = await r.json();
  await page.goto(BASE + "/terms");
  await page.evaluate((v) => localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)), s);
  await page.evaluate((id) => sessionStorage.setItem(`onboarding_redirected_${id}`, "1"), s.user.id);
}
async function snapshot(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    dialogs: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')].filter((e) => e.getBoundingClientRect().width > 0).map((d) => (d.getAttribute("aria-label") || d.querySelector("h2,h3")?.textContent || d.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60)),
    toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.innerText.trim().replace(/\s+/g, " ").slice(0, 90)),
    bodyLen: document.body.innerText.length,
    // Що лежить зверху в трьох точках екрана: відкрита бічна панель / шторка не міняє тексту
    // сторінки (вона вже в DOM), але накриває її — без цього «Меню» читалось як «нічого».
    top: [[195, 420], [30, 700], [360, 200]].map(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + "." + String(e.className).slice(0, 40) : "-"; }).join("|"),
    sig: document.body.innerText.slice(0, 4000),
  }));
}

for (const role of Object.keys(ROUTES)) {
  if (only && !only.includes(role)) continue;
  const email = PEOPLE[role]; if (!email) continue;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "uk-UA", timezoneId: "Europe/Kyiv" });
  await ctx.route(/clarity\.ms|facebook\.(com|net)|fbevents|google-analytics|googletagmanager|doubleclick/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "uk"); localStorage.setItem("oth-cookie-consent-v1", "declined"); } catch { /* */ } });
  let page = await ctx.newPage();
  await login(page, email);
  const rows = [];
  const onlyRoutes = process.env.UX_ROUTES?.split(",");
  for (const route of ROUTES[role]) {
    if (onlyRoutes && !onlyRoutes.includes(route)) continue;
    const t0 = Date.now();
    await page.goto(BASE + route).catch(() => {}); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); await wait(1500);
    const labels = await page.evaluate((SEL) => {
      const seen = new Set(); const out = [];
      for (const el of document.querySelectorAll(SEL)) {
        if (el.closest("nav, aside, [data-bottom-nav]")) continue;
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        const l = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 70);
        if (!l || seen.has(l)) continue; seen.add(l); out.push(l);
      }
      return out;
    }, SEL);
    console.log(`■ ${role} ${route}: ${labels.length} елементів`);
    let dirty = false;
    const fresh = async () => { await page.goto(BASE + route).catch(() => {}); await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); await wait(700); dirty = false; };
    const findTarget = (lbl) => page.evaluate(({ SEL, label }) => {
      document.querySelectorAll("[data-ux-t]").forEach((e) => e.removeAttribute("data-ux-t"));
      for (const el of document.querySelectorAll(SEL)) {
        if (el.closest("nav, aside, [data-bottom-nav]")) continue;
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        const l = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 70);
        if (l === label) { el.setAttribute("data-ux-t", "1"); el.scrollIntoView({ block: "center" }); return true; }
      }
      return false;
    }, { SEL, label: lbl });
    for (const label of labels) {
      if (Date.now() - t0 > PER_ROUTE_MS) { rows.push({ role, route, label, outcome: "не встиг (ліміт часу екрана)" }); continue; }
      if (SKIP.test(label)) { rows.push({ role, route, label, outcome: "пропущено (руйнівне/зовнішнє)" }); continue; }
      try {
        // Кожен дотик — з чистого екрана: попередній міг перемкнути вигляд чи лишити шторку.
        if (dirty || (!page.url().endsWith(route) && !page.url().includes(route))) await fresh();
        const before = await snapshot(page);
        // Ціль — той самий ВИДИМИЙ елемент, який ми порахували (а не перший збіг тексту:
        // перший часто — прихована десктопна копія, і клік «не натискався» через робота).
        let found = await findTarget(label);
        if (!found) { await fresh(); found = await findTarget(label); }
        if (!found) { rows.push({ role, route, label, outcome: "зник з екрана до натискання" }); continue; }
        await page.locator('[data-ux-t="1"]').first().click({ timeout: 2500 });
        await wait(1400);
        const after = await snapshot(page);
        let outcome;
        if (after.url !== before.url) outcome = `→ ${after.url}`;
        else if (after.dialogs.length > before.dialogs.length) outcome = `відкрилось: ${after.dialogs[after.dialogs.length - 1] || "вікно"}`;
        else if (after.toasts.length > before.toasts.length) outcome = `повідомлення: ${after.toasts[after.toasts.length - 1]}`;
        else if (after.sig !== before.sig) outcome = "змінився екран";
        else if (after.top !== before.top) outcome = "відкрилось: панель поверх екрана";
        else outcome = "∅ нічого не сталося";
        rows.push({ role, route, label, outcome });
        dirty = !outcome.startsWith("∅");
      } catch (e) {
        const msg = String(e?.message ?? e).split("\n")[0].slice(0, 90);
        rows.push({ role, route, label, outcome: /Timeout/.test(msg) ? "не натискається (перекрито/невидиме)" : `збій: ${msg}` });
        if (/closed|crashed|destroyed/i.test(msg)) { page = await ctx.newPage(); await login(page, email); }
        dirty = true;
      }
    }
    writeFileSync(`${OUT}/${role}.json`, JSON.stringify(rows, null, 1));
  }
  const dead = rows.filter((r) => r.outcome.startsWith("∅")).length;
  console.log(`══ ${role}: дотиків ${rows.length} · без реакції ${dead}`);
  await browser.close();
}
console.log("готово");
