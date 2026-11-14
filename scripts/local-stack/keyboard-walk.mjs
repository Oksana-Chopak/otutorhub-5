#!/usr/bin/env node
/**
 * «Клавіатура поверх форми» (13.11, скарга власниці: «на мобільній версії боттом-шит форми
 * застилаються клавіатурою»).
 *
 * На телефоні екранна клавіатура НЕ зменшує сторінку: вона лягає поверх нижніх ~40% екрана.
 * Форма-аркуш притиснута до низу екрана — тож її нижня частина (поле, в яке людина пише, і
 * кнопка «Зберегти») опиняється під клавіатурою. У звичайному браузері на компʼютері цього не
 * видно взагалі, тому жоден прохід цього не ловив.
 *
 * Цей робот вмикає «клавіатуру» так, як її бачить сторінка на iPhone і Android: видима висота
 * (`visualViewport.height`) зменшується на висоту клавіатури, а розмір сторінки лишається. Далі
 * в кожній формі кожної ролі він стає в КОЖНЕ текстове поле і звіряє:
 *   1. поле ціле у видимій частині екрана (над клавіатурою);
 *   2. поле не накрите липкою шапкою чи підвалом форми;
 *   3. низ форми не заходить під клавіатуру (кнопки підвалу досяжні).
 *
 * Запуск (стенд піднятий, проходи створили людей):
 *   node scripts/local-stack/keyboard-walk.mjs            # усі ролі
 *   KB_ONLY=manager node scripts/local-stack/keyboard-walk.mjs
 * Код виходу 1 — хоч одне поле чи форма під клавіатурою.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { kbInit, kbCheck, OUT } from "./kb-lib.mjs";

const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : await import("playwright");
const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => spawnSync("psql", ["-X", "-q", "-At", "-d", process.env.STACK_DB ?? "stackdb", "-c", q], {
  encoding: "utf8", env: { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" },
}).stdout.trim();
const latest = (prefix, domain) => psql(`select email from auth.users where email like '${prefix}-%@${domain}' order by created_at desc limit 1`);
const idOf = (email) => psql(`select id from auth.users where email='${email}'`);

const P = {
  manager: latest("maria", "lingua.test"),
  hubtutor: latest("iryna", "lingua.test"),
  student: latest("solomiia", "fam.test"),
  independent: latest("alina", "tutor.test"),
};
const SID = P.student ? idOf(P.student) : "", TID = P.hubtutor ? idOf(P.hubtutor) : "";
// учень школи, якого ще не звели з репетитором (у формі пари тоді є і предмет, і ціна)
const FREE = psql(`select p.id from public.profiles p where p.first_name = 'Наталя' and p.last_name = 'Гість' order by p.created_at desc limit 1`);

const fab = (p) => p.locator("button[class*='fixed']").filter({ has: p.locator("svg") }).last().click({ timeout: 4000 });
const card = (p, name) => p.locator('div[role="button"]', { hasText: name }).first().click({ timeout: 5000 });

/** [назва, як відкрити] — кожна форма, де людина щось пише. */
const STATES = {
  manager: [
    ["форма уроку · нова група", async (p, go) => { await go("/schedule?create=1", 4500); await p.getByRole("button", { name: /Груповий/ }).click(); await wait(500); await p.getByRole("button", { name: /Нова група/ }).click({ timeout: 2500 }).catch(() => {}); }],
    ["додати учня", async (p, go) => { await go("/people?add=student", 3500); await p.getByRole("button", { name: /контакти|Контакти/ }).first().click({ timeout: 1500 }).catch(() => {}); }],
    ["додати репетитора", async (p, go) => { await go("/people?add=tutor", 3500); }],
    ["призначити репетитора (предмет + ціна)", async (p, go) => { await go(`/people?assign=${FREE || SID}&tutor=${TID}`, 4000); const d = p.getByRole("dialog").filter({ hasText: /до учня/ }).last(); await d.locator("[data-subject-chip]").first().click({ timeout: 3000 }); await wait(400); }],
    ["редагувати людину", async (p, go) => { await go("/people?tab=students", 3500); await card(p, "Соломія Гнатюк"); await wait(800); await p.getByRole("button", { name: /Редагувати/ }).first().click({ timeout: 4000 }); }],
    ["нотатка менеджера в картці людини", async (p, go) => { await go("/people?tab=students", 3500); await card(p, "Соломія Гнатюк"); await wait(800); await p.getByRole("dialog").last().getByText(/Приватні нотатки/).click({ timeout: 3000 }); }],
    ["копія уроку (стара форма)", async (p, go) => { await go("/schedule", 4500); await p.getByRole("button", { name: "Дії", exact: true }).nth(1).click({ timeout: 4000 }); await wait(500); await p.getByRole("menuitem", { name: /Копіювати/ }).click({ timeout: 3000 }); }],
    ["копія уроку · пошук предмета у спливному вікні", async (p, go) => { await go("/schedule", 4500); await p.getByRole("button", { name: "Дії", exact: true }).nth(1).click({ timeout: 4000 }); await wait(500); await p.getByRole("menuitem", { name: /Копіювати/ }).click({ timeout: 3000 }); await wait(1200); await p.locator('button[role="combobox"]').last().scrollIntoViewIfNeeded(); await p.locator('button[role="combobox"]').last().click({ timeout: 3000 }); }],
    ["ставка репетитора", async (p, go) => { await go(`/people?open=${TID}&rate=1`, 4500); }],
    ["записати оплату", async (p, go) => { await go("/finances", 4500); await fab(p); }],
    ["нова група", async (p, go) => { await go("/groups", 3500); await fab(p); }],
    ["передоплата · поповнити", async (p, go) => { await go("/wallets", 4000); await p.getByRole("button", { name: /Поповнити/ }).first().click({ timeout: 4000 }); await wait(900); await p.getByRole("dialog").last().getByRole("button", { name: "Поповнити" }).first().click({ timeout: 2500 }).catch(() => {}); }],
    ["профіль", async (p, go) => { await go("/profile", 3500); }],
    ["профіль · редагувати себе", async (p, go) => { await go("/profile", 3500); await p.locator("main button").filter({ has: p.locator("svg.lucide-pencil") }).first().click({ timeout: 3000 }); }],
    ["зворотний звʼязок", async (p, go) => { await go("/dashboard", 3500); await p.getByRole("button", { name: /меню/i }).first().click({ timeout: 4000 }); await wait(600); await p.getByRole("button", { name: /фідбек|Фідбек|відгук/i }).first().click({ timeout: 3000 }); }],
  ],
  hubtutor: [
    ["деталі уроку (лінк, ДЗ, конспект)", async (p, go) => { await go("/schedule", 4500); await p.locator("div[role='button']").filter({ hasText: /Соломія Гнатюк/ }).first().click({ position: { x: 40, y: 40 }, timeout: 5000 }); }],
    ["профіль · редагувати себе", async (p, go) => { await go("/profile", 3500); await p.locator("main button").filter({ has: p.locator("svg.lucide-pencil") }).first().click({ timeout: 3000 }); }],
    ["профіль · предмети", async (p, go) => { await go("/profile", 3500); await p.getByText("Предмети", { exact: true }).first().click({ timeout: 3000 }); }],
    ["профіль · доступність", async (p, go) => { await go("/availability", 3500); }],
    ["чат · поле повідомлення", async (p, go) => { await go("/chats", 3500); await p.locator("main button, main [role='button']").filter({ hasText: /Соломія|Марія/ }).first().click({ timeout: 4000 }); }],
  ],
  independent: [
    ["форма уроку · новий учень", async (p, go) => { await go("/schedule?create=1", 4500); await p.getByRole("button", { name: /Додати учня/ }).last().click({ timeout: 4000 }); await wait(700); await p.getByRole("button", { name: /контакти|Контакти/ }).first().click({ timeout: 1500 }).catch(() => {}); }],
    ["форма уроку · нова група", async (p, go) => { await go("/schedule?create=1", 4500); await p.getByRole("button", { name: /Груповий/ }).click(); await wait(500); await p.getByRole("button", { name: /Нова група/ }).click({ timeout: 2500 }).catch(() => {}); }],
    ["мої учні · додати", async (p, go) => { await go("/my-students", 3500); await p.getByRole("button", { name: "Додати учня" }).first().click({ timeout: 4000 }); await wait(700); await p.getByRole("button", { name: /контакти|Контакти/ }).first().click({ timeout: 1500 }).catch(() => {}); }],
    ["мої учні · редагувати учня", async (p, go) => { await go("/my-students", 3500); await p.getByText(/Тимур Бондар/).first().click({ timeout: 4000 }); await wait(900); await p.locator("main button").filter({ has: p.locator("svg.lucide-pencil") }).first().click({ timeout: 3000 }); await wait(700); await p.getByRole("button", { name: /контакти|Контакти/ }).first().click({ timeout: 1500 }).catch(() => {}); }],
    ["мої учні · пошук", async (p, go) => { await go("/my-students", 3500); await p.locator("main button").filter({ has: p.locator("svg.lucide-search") }).first().click({ timeout: 3000 }); }],
    ["імпорт учнів", async (p, go) => { await go("/my-students", 3500); await p.getByRole("button", { name: "Перенести все, що є" }).first().click({ timeout: 3000 }); }],
    ["записати оплату", async (p, go) => { await go("/finances", 4500); await fab(p); }],
    ["нова група", async (p, go) => { await go("/groups", 3500); await fab(p); }],
    ["деталі уроку (лінк, ДЗ, конспект)", async (p, go) => { await go("/schedule", 4500); await p.locator("div[role='button']").filter({ hasText: /Тимур Бондар/ }).first().click({ position: { x: 40, y: 40 }, timeout: 5000 }); }],
    ["передоплата · поповнити", async (p, go) => { await go("/wallets", 4000); await p.getByRole("button", { name: /Поповнити/ }).first().click({ timeout: 4000 }); await wait(900); await p.getByRole("dialog").last().getByRole("button", { name: "Поповнити" }).first().click({ timeout: 2500 }).catch(() => {}); }],
    ["профіль · редагувати себе", async (p, go) => { await go("/profile", 3500); await p.locator("main button").filter({ has: p.locator("svg.lucide-pencil") }).first().click({ timeout: 3000 }); }],
    ["профіль · керуєте школою?", async (p, go) => { await go("/profile", 3500); await p.getByText(/Керуєте школою/).first().click({ timeout: 3000 }); }],
    ["підписка · заявка", async (p, go) => { await go("/subscription", 3500); }],
  ],
  student: [
    ["профіль учня", async (p, go) => { await go("/student/profile", 3500); }],
    ["запит на зміну уроку", async (p, go) => { await go("/student/schedule", 4000); await p.getByRole("button", { name: /Скасувати|Перенести/ }).first().click({ timeout: 4000 }); }],
    ["чат · поле повідомлення", async (p, go) => { await go("/chats", 3500); await p.locator("main button, main [role='button']").filter({ hasText: /Ірина|Марія/ }).first().click({ timeout: 4000 }); }],
  ],
  guest: [
    ["вхід", async (p, go) => { await go("/auth", 3000); }],
    ["реєстрація", async (p, go) => { await go("/auth?signup=1", 3000); await p.getByRole("button", { name: /Репетитор/ }).click({ timeout: 2000 }).catch(() => {}); }],
    ["забули пароль", async (p, go) => { await go("/auth", 3000); await p.getByRole("button", { name: /Забули пароль/ }).click({ timeout: 2500 }); }],
    ["лендінг · калькулятор і список учнів", async (p, go) => { await go("/", 4000); }],
  ],
};

const only = process.env.KB_ONLY?.split(",");
const findings = []; let total = 0, forms = 0;
for (const [role, states] of Object.entries(STATES)) {
  if (only && !only.includes(role)) continue;
  if (role !== "guest" && !P[role]) { console.log(`⚠️ ${role}: людини немає на стенді`); continue; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "uk-UA", timezoneId: "Europe/Kyiv", hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "uk"); } catch { /* приватний режим */ }
  });
  await ctx.addInitScript(kbInit);
  const page = await ctx.newPage();
  const go = async (path, ms = 3200) => { await page.goto(BASE + path).catch(() => {}); await wait(ms); await page.getByRole("button", { name: "Прийняти" }).click({ timeout: 800 }).catch(() => {}); };
  if (role !== "guest") {
    const r = await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: P[role], password: "x" }) });
    const s = await r.json();
    if (!s.access_token) throw new Error("вхід не вдався: " + P[role]);
    await page.goto(BASE + "/terms");
    await page.evaluate((v) => localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)), s);
    await go("/dashboard", 3500);
    if (/onboarding/.test(page.url())) { await page.getByText(/Зроблю пізніше/).click({ timeout: 2500 }).catch(() => {}); await wait(1500); }
  }
  for (const [name, open] of states) {
    const where = `${role} · ${name}`;
    console.log("■ " + where);
    try { await open(page, go); } catch (e) { console.log(`   (не відкрилось: ${String(e.message).split("\n")[0].slice(0, 90)})`); findings.push(`${where} · форма НЕ ВІДКРИЛАСЬ — не перевірено (14.11: мовчазний пропуск ховав зміну форми)`); if (process.env.KB_SHOTS) await page.screenshot({ path: `${OUT}/NOTOPEN_${where.replace(/[^a-zа-яіїє0-9]+/gi, "_")}.png` }).catch(() => {}); continue; }
    await wait(900);
    const n = await kbCheck(page, where, findings);
    if (n) { forms++; total += n; }
  }
  await browser.close();
}
console.log(`\n══ форм ${forms} · полів ${total} · під клавіатурою ${findings.length}`);
for (const f of findings) console.log("  ✗ " + f);
process.exit(findings.length ? 1 : 0);
