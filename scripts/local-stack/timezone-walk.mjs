#!/usr/bin/env node
/**
 * «Кожному — його час» (14.11) — прохід у трьох часових поясах на справжній базі.
 *
 * Питання власниці: «я в Стокгольмі, репетитор у Києві, учень у Берліні — по якому поясу я
 * назначаю урок?». Прохід робить рівно це: репетиторка заходить «із Києва», учениця — «з
 * Берліна» (застосунок сам записує пояс пристрою в базу), менеджерка «у Стокгольмі» відкриває
 * форму уроку — і мусить побачити свій пояс і час репетиторки поіменно; учениця, що пропонує
 * інший час, — час репетитора.
 *
 * Запуск — після school-walk (він створює цих людей і урок):
 *   node scripts/local-stack/timezone-walk.mjs
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : await import("playwright");
const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => spawnSync("psql", ["-X", "-q", "-At", "-d", process.env.STACK_DB ?? "stackdb", "-c", q], {
  encoding: "utf8", env: { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" },
}).stdout.trim();
const who = (pfx, dom) => psql(`select email from auth.users where email like '${pfx}-%@${dom}' order by created_at desc limit 1`);
const idOf = (email) => psql(`select id from auth.users where email = '${email}'`);

const mgr = who("maria", "lingua.test"), tut = who("iryna", "lingua.test"), stu = who("solomiia", "fam.test");
if (!mgr || !tut || !stu) { console.log("⚠️ людей немає на стенді — спершу school-walk"); process.exit(1); }
psql(`update profiles set timezone = null where id in ('${idOf(mgr)}', '${idOf(tut)}', '${idOf(stu)}')`);

const problems = [];
const ok = (m) => console.log("✅ " + m);
const must = (cond, m, got) => { if (cond) ok(m); else { problems.push(m); console.log(`❌ ${m}${got !== undefined ? ` — на екрані: «${String(got).slice(0, 200)}»` : ""}`); } };

const browser = await chromium.launch();
async function session(email, tz) {
  const s = await (await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "x" }) })).json();
  if (!s.access_token) throw new Error("вхід не вдався: " + email);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "uk-UA", timezoneId: tz });
  // стенд не ходить до сторонніх лічильників (див. school-walk)
  await ctx.route(/clarity\.ms|facebook\.(com|net)|fbevents|google-analytics|googletagmanager|doubleclick/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`помилка JS (${tz}): ${String(e.message).slice(0, 160)}`));
  page.on("response", (r) => { if (r.status() >= 400 && /\/rest\/v1\//.test(r.url())) problems.push(`${r.status()} ${r.url().split("/rest/v1")[1].slice(0, 80)} (${tz})`); });
  await page.goto(BASE + "/terms");
  await page.evaluate((v) => { localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)); localStorage.setItem("i18nextLng", "uk"); }, s);
  const go = async (path, ms = 4500) => { await page.goto(BASE + path); await wait(ms); await page.getByRole("button", { name: "Прийняти" }).click({ timeout: 600 }).catch(() => {}); };
  const note = async () => (await page.locator("[data-tz-note]").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()).join(" ‖ ");
  return { page, go, note, ctx };
}

// 1. Кожен заходить зі свого міста — застосунок сам записує пояс пристрою
for (const [email, tz, path] of [[tut, "Europe/Kyiv", "/dashboard"], [stu, "Europe/Berlin", "/student-dashboard"]]) {
  const s = await session(email, tz);
  await s.go(path, 4000);
  await s.ctx.close();
}
const tzTut = psql(`select timezone from profiles where id = '${idOf(tut)}'`);
const tzStu = psql(`select timezone from profiles where id = '${idOf(stu)}'`);
must(/^Europe\/(Kyiv|Kiev)$/.test(tzTut), "пояс репетиторки записався сам, коли вона зайшла з Києва", tzTut);
must(tzStu === "Europe/Berlin", "пояс учениці записався сам, коли вона зайшла з Берліна", tzStu);

// 2. Менеджерка у Стокгольмі ставить урок
const m = await session(mgr, "Europe/Stockholm");
await m.go("/schedule?create=1", 5000);
await m.page.getByRole("button", { name: /Соломія Гнатюк/ }).click({ timeout: 5000 }); await wait(1500);
let n = await m.note();
must(/За твоїм часом: Стокгольм \(GMT\+[12]\)/.test(n), "форма уроку каже, що час — за Стокгольмом", n);
must(/Ірина Коваль: \d\d:\d\d · Київ \(GMT\+[23]\)/.test(n), "форма уроку називає час репетиторки в Києві", n);
must(!/Соломія Гнатюк:/.test(n), "про ученицю в Берліні форма мовчить — у неї той самий час", n);
must(!/Кожен учасник побачить/.test(n), "пояси всіх відомі — загального речення немає", n);
{
  // цифра: у Києві на годину більше, ніж у Стокгольмі
  const hero = (await m.page.getByRole("dialog").last().innerText()).match(/\b(\d\d):(\d\d)\b/);
  const kyiv = n.match(/Ірина Коваль: (\d\d):(\d\d)/);
  must(!!hero && !!kyiv && (Number(kyiv[1]) - Number(hero[1]) + 24) % 24 === 1 && kyiv[2] === hero[2], "у репетиторки на годину більше, ніж у формі менеджерки", `${hero?.[0]} → ${kyiv?.[0]}`);
}
must(psql(`select timezone from profiles where id = '${idOf(mgr)}'`) === "Europe/Stockholm", "пояс менеджерки записався сам");
await m.go("/schedule", 4500);
await m.page.locator("div[role='button']").filter({ hasText: /Соломія Гнатюк/ }).first().click({ position: { x: 40, y: 40 }, timeout: 5000 });
await wait(1800);
n = await m.note();
must(/Репетитор: \d\d:\d\d · Київ/.test(n), "деталі уроку кажуть час репетитора в Києві", n);
await m.ctx.close();

// 3. Учениця в Берліні пропонує інший час
const st = await session(stu, "Europe/Berlin");
await st.go("/student/schedule", 4500);
await st.page.getByRole("button", { name: /Перенести/ }).first().click({ timeout: 5000 });
await wait(1200);
n = await st.note();
must(/За твоїм часом: Берлін/.test(n), "учениця бачить, що час — за Берліном", n);
must(/Репетитор: \d\d:\d\d · Київ/.test(n), "і який це час у репетитора в Києві", n);
await st.ctx.close();

await browser.close();
if (problems.length) {
  console.log("\n❌ збої під час проходу:");
  for (const p of problems) console.log("  ✗ " + p);
  process.exit(1);
}
console.log("\n✅ прохід «кожному — його час» — три пояси, без збоїв бази й помилок JS");
