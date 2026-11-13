#!/usr/bin/env node
/**
 * «Кожна кнопка» (13.11) — робот, який НАТИСКАЄ ВСЕ.
 *
 * Чому він є. Проходи school-walk / roles-walk ідуть заздалегідь написаним шляхом і звіряють
 * гроші. Вони не помічали, що колонка годин не гортається, що щойно доданого учня немає у формі
 * уроку, що список учнів стиснувся до смужки. Усе це — «екран відкрився, але елемент на ньому
 * мертвий». Цей робот не знає шляху: на кожному екрані кожної ролі він натискає КОЖЕН елемент
 * керування, а у вікні, що відкрилось, — кожен елемент усередині, і після кожного дотику питає:
 *   1. чи не впав запит до бази (4xx/5xx) і чи немає помилки JS;
 *   2. чи не зʼявилось червоне повідомлення (його текст іде у звіт);
 *   3. чи змінилось хоч щось (нічого не змінилось = мертва кнопка);
 *   4. чи кожна прокрутна зона у вікні справді гортається колесом;
 *   5. чи кожен елемент у вікні досяжний (не накритий іншим);
 *   6. чи немає на екрані сирих ключів перекладу, «undefined», «NaN».
 *
 * Запуск (стенд піднятий, проходи вже створили людей):
 *   node scripts/local-stack/every-button.mjs            # усі ролі
 *   EB_ONLY=manager,student node scripts/local-stack/every-button.mjs
 * Звіт: /tmp/every-button/<роль>.json + зведення в консолі. Код виходу 1 — є збої бази/JS,
 * мертві прокрутки або накриті елементи (червоні повідомлення й «мертві кнопки» — на розгляд).
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : await import("playwright");
const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const OUT = process.env.EB_OUT ?? "/tmp/every-button";
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
const ONLY_ROUTES = process.env.EB_ROUTES?.split(",");
const ROUTES = {
  manager: ["/dashboard", "/schedule", "/schedule?view=week", "/people", "/people?tab=students", "/groups", "/chats", "/finances", "/finances?tab=debts", "/wallets", "/referrals", "/availability", "/profile", "/audit"],
  hubtutor: ["/dashboard", "/schedule", "/groups", "/chats", "/finances", "/availability", "/achievements", "/profile"],
  student: ["/student-dashboard", "/student/schedule", "/student/payments", "/student/homework", "/student/achievements", "/student/profile", "/chats"],
  independent: ["/dashboard", "/schedule", "/schedule?view=week", "/my-students", "/groups", "/chats", "/finances", "/finances?tab=debts", "/wallets", "/availability", "/achievements", "/my-referrals", "/profile", "/subscription"],
  superadmin: ["/dashboard", "/admin", "/errors", "/feedback-inbox", "/marketing", "/subscription-requests", "/paywall-metrics"],
  guest: ["/", "/auth", "/auth?signup=1", "/for-students", "/reset-password"],
};
// Не натискаємо: вихід, видалення (дані потрібні наступним екранам), оплата карткою (edge),
// вхід через Google, зовнішні посилання.
const SKIP = /^(Вийти|Вийти з акаунта)$|Видалити|видалити|Архів|Google|LiqPay|Перейти до оплати|Оплатити карткою|Скинути|Очистити все/;
const MAX_L1 = Number(process.env.EB_MAX ?? 70), MAX_L2 = 45;

const SEL = "button, a[href], [role=button], [role=tab], [role=switch], [role=menuitem], [role=option], [role=combobox], [role=checkbox], [role=radio], summary";

/** Позначити елементи керування в межах `scope` ("page" | "top") і повернути їх описи. */
async function tag(page, scope, attr) {
  return page.evaluate(({ SEL, scope, attr }) => {
    document.querySelectorAll(`[${attr}]`).forEach((e) => e.removeAttribute(attr));
    const layers = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],aside')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 10; });
    const top = layers[layers.length - 1];
    const root = scope === "top" ? top : document.body;
    if (!root) return [];
    const out = [];
    let i = 0;
    for (const el of root.querySelectorAll(SEL)) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width < 6 || r.height < 6 || cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (scope === "top" && el.closest("nav")) continue;                // посилання меню — це маршрути
      if (scope === "page") {
        if (el.closest("nav, aside")) continue;                          // навігацію проходимо маршрутами
        if (r.right <= 0 || r.left >= innerWidth) continue;              // сховане меню збоку
        if (el.closest('[role="dialog"],[role="alertdialog"]')) continue;
      }
      const href = el.getAttribute("href") || "";
      if (/^(https?:|mailto:|tel:|tg:)/.test(href) && !href.startsWith(location.origin)) continue;
      if (el.getAttribute("target") === "_blank") continue;
      const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("placeholder") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 44);
      el.setAttribute(attr, String(i));
      out.push({ i, label, href: href.slice(0, 60) });
      i++;
    }
    return out;
  }, { SEL, scope, attr });
}

async function probes(page) {
  // дотик міг запустити перехід — чекаємо, поки сторінка заспокоїться, і питаємо ще раз
  for (let k = 0; k < 3; k++) {
    try { return await probesOnce(page); } catch { await wait(900); }
  }
  return probesOnce(page);
}
async function probesOnce(page) {
  return page.evaluate(() => {
    const layers = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],aside')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 10; });
    const top = layers[layers.length - 1];
    const toasts = [...document.querySelectorAll("[data-sonner-toast]")].map((t) => ({ type: t.getAttribute("data-type") || "", text: (t.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140) }));
    const txt = (top || document.body).innerText || "";
    const raw = (txt.match(/\b[a-z][A-Za-z]+\.[a-z][A-Za-z]+(\.[A-Za-z]+)*\b/g) || []).filter((k) => !/\.(com|test|ua|io|app|me|se|json|sql)$|otutorhub|gmail|google|lingua|e\.g|т\.д/i.test(k)).slice(0, 3);
    const junk = (txt.match(/[^\n]*\b(undefined|NaN|\[object Object\])\b[^\n]*/g) || []).slice(0, 2).map((x) => x.trim().slice(0, 80));
    return { layers: layers.length, topText: top ? (top.innerText || "").replace(/\s+/g, " ").slice(0, 60) : "", toasts, raw, junk, url: location.pathname + location.search, mut: window.__ebMut || 0 };
  });
}

/** Прокрутні зони верхнього шару справді гортаються; елементи діалогу не накриті. */
async function auditLayer(page) {
  const found = [];
  const zones = await page.evaluate(() => {
    const out = []; let i = 0;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 8) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 30 || r.height < 30 || r.bottom < 0 || r.top > innerHeight) continue;
      const cx = r.left + r.width / 2, cy = Math.min(innerHeight - 5, Math.max(5, r.top + Math.min(r.height / 2, 60)));
      const t = document.elementFromPoint(cx, cy);
      if (!t || !(el === t || el.contains(t))) continue;
      el.setAttribute("data-eb-zone", String(i));
      out.push({ i, cx, cy, top: el.scrollTop, max: el.scrollHeight - el.clientHeight, tag: (el.getAttribute("role") || el.tagName) + "." + String(el.className).slice(0, 36) });
      i++;
    }
    return out;
  });
  for (const z of zones) {
    const dir = z.top >= z.max - 2 ? -120 : 120;
    await page.mouse.move(z.cx, z.cy); await page.mouse.wheel(0, dir); await wait(300);
    const moved = await page.evaluate((zs) => zs.some((q) => { const e = document.querySelector(`[data-eb-zone="${q.i}"]`); return e && e.scrollTop !== q.top; }), zones);
    if (!moved) found.push(`МЕРТВА ПРОКРУТКА ${z.tag}`);
    await page.mouse.wheel(0, -dir); await wait(120);
  }
  await page.evaluate(() => document.querySelectorAll("[data-eb-zone]").forEach((e) => e.removeAttribute("data-eb-zone")));
  const covered = await page.evaluate((SEL) => {
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
    const root = ds[ds.length - 1]; const out = [];
    if (!root) return out;
    for (const el of root.querySelectorAll(SEL + ", input:not([type=hidden]), textarea, select")) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || cs.visibility === "hidden" || cs.pointerEvents === "none" || el.disabled) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const t = document.elementFromPoint(cx, cy);
      if (!t || el === t || el.contains(t) || t.contains(el)) continue;
      const lab = el.closest("label"); if (lab && lab.contains(t)) continue;
      let clipped = false;
      for (let a = el.parentElement; a; a = a.parentElement) { const ar = a.getBoundingClientRect(); if (/(auto|scroll|hidden)/.test(getComputedStyle(a).overflowY) && (cy < ar.top || cy > ar.bottom)) { clipped = true; break; } }
      if (clipped) continue;
      if (!root.contains(t) && t.closest("[data-radix-popper-content-wrapper],[data-sonner-toast]")) continue; // відкрите спливне чи повідомлення — тимчасове
      out.push(`НАКРИТО «${(el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 26)}» ← ${t.tagName}.${String(t.className).slice(0, 24)}`);
    }
    return [...new Set(out)].slice(0, 5);
  }, SEL);
  return found.concat(covered);
}

async function runRole(role) {
  const email = PEOPLE[role];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "uk-UA", timezoneId: "Europe/Kyiv", permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "uk"); } catch { /* приватний режим */ }
    window.__ebMut = 0;
    const start = () => new MutationObserver((m) => { window.__ebMut += m.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start);
  });
  const page = await ctx.newPage();
  const net = [];
  page.on("pageerror", (e) => net.push(`помилка JS: ${String(e.message).slice(0, 180)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/501|Failed to load resource|favicon|net::ERR|WebSocket|realtime/.test(m.text())) net.push(`console.error: ${m.text().slice(0, 180)}`); });
  page.on("response", async (r) => {
    const u = r.url();
    if (r.status() >= 400 && (u.includes("/rest/v1") || u.includes("/auth/v1"))) {
      let b = ""; try { b = (await r.text()).slice(0, 160); } catch { /* тіло закрите */ }
      net.push(`${r.status()} ${r.request().method()} ${u.replace(GW, "").slice(0, 110)} ${b}`);
    }
  });
  const go = async (path, ms = 3200) => {
    await page.goto(BASE + path).catch(() => {}); await wait(ms);
    await page.getByRole("button", { name: "Прийняти" }).click({ timeout: 800 }).catch(() => {});
  };
  if (email) {
    const r = await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "x" }) });
    const s = await r.json();
    if (!s.access_token) throw new Error("вхід не вдався: " + email);
    await page.goto(BASE + "/terms");
    await page.evaluate((v) => localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)), s);
    await go("/dashboard", 3500);
    if (/onboarding/.test(page.url())) { await page.getByText(/Зроблю пізніше/).click({ timeout: 2500 }).catch(() => {}); await wait(1500); }
  }
  const rows = [];
  const clean = async (route) => {
    for (let k = 0; k < 3; k++) {
      const p = await probes(page);
      if (!p.layers) break;
      await page.keyboard.press("Escape"); await wait(280);
    }
    const p = await probes(page);
    if (p.layers || p.url !== route) await go(route, 2600);
  };
  const press = async (attr, i, label) => {
    const before = net.length;
    // повідомлення не чіпаємо (видалення вузла руками валить React) — запамʼятовуємо, які вже були
    const had = await page.evaluate(() => { window.__ebMut = 0; return [...document.querySelectorAll("[data-sonner-toast]")].map((t) => (t.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140)); });
    const el = page.locator(`[${attr}="${i}"]`).first();
    let err = "";
    try { await el.scrollIntoViewIfNeeded({ timeout: 1500 }); await el.click({ timeout: 2500 }); } catch (e) { err = String(e.message).replace(/\s+/g, " ").slice(0, 900); }
    await wait(850);
    const p = await probes(page);
    p.toasts = p.toasts.filter((t) => !had.includes(t.text));
    return { label, err, net: net.slice(before), ...p };
  };

  for (const route of (ONLY_ROUTES ?? ROUTES[role])) {
    writeFileSync(`${OUT}/${role}.json`, JSON.stringify(rows, null, 1));
    await go(route, 3400);
    const first = await probes(page);
    const base = { role, route };
    if (first.raw.length || first.junk.length) rows.push({ ...base, path: "(екран)", raw: first.raw, junk: first.junk });
    const l1 = (await tag(page, "page", "data-eb1")).filter((c) => !SKIP.test(c.label)).slice(0, MAX_L1);
    console.log(`■ ${role} ${route}: елементів ${l1.length}`);
    const seen = new Set();
    for (const c of l1) {
      const key = c.label + "|" + c.href; if (seen.has(key)) continue; seen.add(key);   // однакові кнопки в списку — один раз
      await go(route, 2300);   // кожен дотик — з чистого екрана: попередній міг лишити пошук, фільтр, відкрите меню
      const again = (await tag(page, "page", "data-eb1")).find((x) => x.label === c.label && x.href === c.href);
      if (!again) continue;
      const r = await press("data-eb1", again.i, c.label);
      const row = { ...base, path: c.label, err: r.err, net: r.net, toasts: r.toasts, raw: r.raw, junk: r.junk, nav: r.url !== route ? r.url : "", layer: r.layers ? r.topText : "", dead: !r.err && r.mut === 0 && r.url === route };
      if (r.layers) {
        row.audit = await auditLayer(page);
        // другий рівень: усе всередині відкритого вікна
        const l2 = (await tag(page, "top", "data-eb2")).filter((x) => !SKIP.test(x.label)).slice(0, MAX_L2);
        const seen2 = new Set();
        for (const d of l2) {
          if (seen2.has(d.label)) continue; seen2.add(d.label);
          let p = await probes(page);
          if (!p.layers || p.url !== route) {                     // вікно закрилось — відкриваємо знову
            await clean(route);
            const re = (await tag(page, "page", "data-eb1")).find((x) => x.label === c.label && x.href === c.href);
            if (!re) break;
            await press("data-eb1", re.i, c.label);
            p = await probes(page);
            if (!p.layers) break;
          }
          const inner = (await tag(page, "top", "data-eb2")).find((x) => x.label === d.label);
          if (!inner) continue;
          const r2 = await press("data-eb2", inner.i, d.label);
          const row2 = { ...base, path: `${c.label} ▸ ${d.label}`, err: r2.err, net: r2.net, toasts: r2.toasts, raw: r2.raw, junk: r2.junk, nav: r2.url !== route ? r2.url : "", dead: !r2.err && r2.mut === 0 && r2.url === route };
          if (r2.layers) row2.audit = await auditLayer(page);
          // третій шар (спливне у вікні) закриваємо одним Escape, вікно лишається
          const after = await probes(page);
          if (after.layers > p.layers) { await page.keyboard.press("Escape"); await wait(250); }
          rows.push(row2);
        }
      }
      rows.push(row);
    }
  }
  await browser.close();
  writeFileSync(`${OUT}/${role}.json`, JSON.stringify(rows, null, 1));
  return rows;
}

const only = process.env.EB_ONLY?.split(",");
let hard = 0;
for (const role of Object.keys(ROUTES)) {
  if (only && !only.includes(role)) continue;
  if (role !== "guest" && !PEOPLE[role]) { console.log(`⚠️ ${role}: людини немає на стенді — спершу school-walk і roles-walk`); continue; }
  const rows = await runRole(role);
  const bad = rows.filter((r) => (r.net?.length) || r.err || r.audit?.length || r.raw?.length || r.junk?.length);
  const toasts = rows.filter((r) => r.toasts?.some((t) => t.type === "error"));
  const dead = rows.filter((r) => r.dead);
  hard += rows.filter((r) => r.net?.length || r.audit?.some((a) => a.startsWith("МЕРТВА"))).length;
  console.log(`\n══ ${role}: дотиків ${rows.length} · збої ${bad.length} · червоні повідомлення ${toasts.length} · без реакції ${dead.length}`);
  for (const r of bad) console.log(`  ✗ ${r.route} · ${r.path}: ${[r.err && "не натискається: " + r.err.slice(-520), ...(r.net || []), ...(r.audit || []), r.raw?.length ? "ключі: " + r.raw.join(", ") : "", ...(r.junk || [])].filter(Boolean).join(" ‖ ")}`);
  for (const r of toasts) console.log(`  ⚠ ${r.route} · ${r.path}: ${r.toasts.filter((t) => t.type === "error").map((t) => t.text).join(" | ")}`);
  for (const r of dead) console.log(`  ∅ ${r.route} · ${r.path}`);
}
process.exit(hard ? 1 : 0);
