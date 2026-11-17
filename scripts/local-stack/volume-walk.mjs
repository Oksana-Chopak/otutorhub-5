#!/usr/bin/env node
/**
 * ПРОХІД «ВЕЛИКА ШКОЛА» (17.11) — те саме, що бачить менеджер школи на 150 учнів.
 *
 * База віддає не більше 1000 рядків за запит і мовчить про решту. Поки в застосунку працювала
 * одна репетиторка, жоден екран до цієї межі не доходив, і жоден прохід її не бачив: у школі
 * проходів — три учні. На посіяній школі (12 репетиторів, 150 учнів, 4 320 уроків) «Мій день»
 * казав «0 уроків сьогодні» при 30, «Розклад» починався з уроків через два тижні, «Фінанси»
 * писали «Учні винні 0 ₴» при 270 950 ₴ у базі.
 *
 * Прохід сіє таку школу (`big-school.sql` — під ролями суперадміна й менеджерки, як у житті),
 * відкриває чотири екрани менеджерки на телефоні й звіряє цифри на екрані з базою.
 * Запуск: після `bash scripts/local-stack/up.sh`. У CI — крок у `walks.yml`.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : await import("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" };
const DB = process.env.STACK_DB ?? "stackdb";
const psql = (q) => spawnSync("psql", ["-X", "-q", "-At", "-d", DB, "-c", q], { encoding: "utf8", env }).stdout.trim();

const problems = [];
const ok = (m) => console.log("✅ " + m);
const must = (cond, m, got) => { if (cond) ok(m); else { problems.push(m); console.log(`❌ ${m}${got !== undefined ? ` — на екрані: «${String(got).slice(0, 220)}»` : ""}`); } };

// 1. Посів (якщо велика школа вже є на цьому стенді — другу не сіємо)
let mgr = psql("select email from auth.users where email like 'bigmgr-%@big.test' order by created_at desc limit 1");
if (!mgr) {
  const t0 = Date.now();
  const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", join(HERE, "big-school.sql")], { encoding: "utf8", env, maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.log("❌ посів великої школи не пройшов:\n" + (r.stderr || "").split("\n").filter((l) => /ERROR|DETAIL|CONTEXT/.test(l)).slice(0, 6).join("\n")); process.exit(1); }
  mgr = psql("select email from auth.users where email like 'bigmgr-%@big.test' order by created_at desc limit 1");
  console.log(`   посіяно за ${Math.round((Date.now() - t0) / 1000)} с`);
}
const mid = psql(`select id from auth.users where email = '${mgr}'`);
// цифри з бази; «сьогодні» — за UTC, і браузер нижче теж у UTC
const day = (shift) => `(l.starts_at at time zone 'UTC')::date = ((now() at time zone 'UTC') + interval '${shift} day')::date`;
const [lessons, today, tomorrow, debt, students] = psql(`
  select count(*) || '|' || count(*) filter (where ${day(0)}) || '|' || count(*) filter (where ${day(1)}) || '|' ||
         coalesce(sum(d.student_price) filter (where l.status = 'completed' and d.student_payment_status is distinct from 'paid'), 0)::bigint || '|' ||
         (select count(*) from hub_members hm join user_roles r on r.user_id = hm.user_id and r.role = 'student'
           where hm.hub_id = (select hub_id from hub_managers where user_id = '${mid}' limit 1))
  from lessons l join lesson_details d on d.lesson_id = l.id where l.created_by = '${mid}'`).split("|").map(Number);
must(lessons > 4000 && today >= 20 && debt > 100000 && students === 150, `школа посіяна: ${lessons} уроків, сьогодні ${today}, завтра ${tomorrow}, борг учнів ${debt} ₴, учнів ${students}`);

// 2. Менеджерка відкриває застосунок на телефоні
const s = await (await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: mgr, password: "x" }) })).json();
if (!s.access_token) { console.log("❌ вхід менеджерки великої школи не вдався"); process.exit(1); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "uk-UA", timezoneId: "UTC" });
await ctx.route(/clarity\.ms|facebook\.(com|net)|fbevents|google-analytics|googletagmanager|doubleclick/, (r) => r.abort());
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push(`помилка JS: ${String(e.message).slice(0, 160)}`));
page.on("response", (r) => { if (r.status() >= 400 && /\/rest\/v1\//.test(r.url())) problems.push(`${r.status()} ${r.url().split("/rest/v1")[1].slice(0, 90)}`); });
await page.goto(BASE + "/terms");
await page.evaluate((v) => { localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)); localStorage.setItem("i18nextLng", "uk"); localStorage.setItem("cookie_consent", "accepted"); }, s);
const open = async (path) => {
  const t0 = Date.now();
  await page.goto(BASE + path);
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  const ms = Date.now() - t0;
  await wait(2500);
  await page.getByRole("button", { name: "Прийняти" }).click({ timeout: 500 }).catch(() => {});
  return { text: (await page.locator("body").innerText()).replace(/\s+/g, " "), ms };
};
const num = (x) => Number(String(x ?? "").replace(/[^\d]/g, ""));

// 3. «Мій день»: сьогоднішні уроки на місці, а лічильник з обрізаного списку не видає себе за повний
let v = await open("/dashboard");
let m = v.text.match(/(\d+) урок\S* сьогодні/);
must(m && Number(m[1]) === today, `«Мій день»: ${today} уроків сьогодні — як у базі (${v.ms} мс)`, m ? m[0] : v.text.slice(0, 200));
m = v.text.match(/Очікують оплати: ([\d+]+)/);
must(m && m[1].endsWith("+") && /Показано не весь борг/.test(v.text), "«Мій день»: число з обрізаного списку показано як «N+» і сказано, де повна сума", m ? m[0] : "рядка немає");

// 4. «Розклад»: сьогодні й завтра — повні, і сказано, що далі є ще
v = await open("/schedule");
const bucket = (name) => { const x = v.text.match(new RegExp(name + "\\s*·\\s*(\\d+)")); return x ? Number(x[1]) : null; };
must(bucket("Сьогодні") === today, `«Розклад»: «Сьогодні · ${today}» — як у базі (${v.ms} мс)`, v.text.match(/Сьогодні[^А-Яа-я]{0,12}/)?.[0]);
must(bucket("Завтра") === tomorrow, `«Розклад»: «Завтра · ${tomorrow}» — як у базі`, v.text.match(/Завтра[^А-Яа-я]{0,12}/)?.[0]);
must(/Показано уроки до [^.]{3,30}далі є ще/.test(v.text) && await page.locator("[data-list-cut]").count() > 0, "«Розклад»: показано не все — це сказано словами, є «завантажити ще»");

// 5. «Фінанси»: борг учнів — до гривні як у базі
v = await open("/finances");
m = v.text.match(/Учні винні ([\d\s  ]+)₴/);
must(m && num(m[1]) === debt, `«Фінанси»: «Учні винні ${debt.toLocaleString("uk-UA")} ₴» — як у базі (${v.ms} мс)`, m ? m[0] : v.text.slice(0, 200));
must(/Цифри звірені з базою/.test(v.text), "«Фінанси»: екран сам звірив свої цифри з базою");

// 6. «Люди»: усі 150 учнів
v = await open("/people?tab=students");
m = v.text.match(/Учень\s*(\d+)/);
must(m && Number(m[1]) === students, `«Люди»: учнів ${students} — усі`, m ? m[0] : v.text.slice(0, 160));

await browser.close();
const uniq = [...new Set(problems)];
if (uniq.length) { console.log("\n❌ прохід «велика школа» — збої:\n   " + uniq.slice(0, 12).join("\n   ")); process.exit(1); }
console.log("\n✅ прохід «велика школа» — цифри на екрані = цифри в базі, без збоїв бази й помилок JS");
