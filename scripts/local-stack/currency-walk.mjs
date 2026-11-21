#!/usr/bin/env node
/**
 * ПРОХІД «УЧЕНИЦЯ ПЛАТИТЬ У ЄВРО» (21.11, скарга власниці).
 *
 * «Мені в Telegram приходять борги від нової учениці 28 гривень, тоді як вона оплачує 14 євро
 * за урок.» У школі, де всі платили в гривні, зʼявилась учениця з ціною в євро — і поїхало все,
 * що складало гроші в одне число: «Учні винні 28 ₴», «Прибуток 14 ₴», «Очікувані платежі 964 ₴»,
 * а виплата репетиторці за її урок показувалась як «€300» (валюта учня замість валюти школи).
 *
 * Прохід додає таку ученицю в школу проходів (під роллю менеджерки, тими самими таблицями, що й
 * застосунок): ціна 14 €, три проведені уроки (один оплачений) і один майбутній — і звіряє
 * екрани менеджерки й репетиторки школи. Запуск: після `school-walk.mjs`. У CI — крок у walks.yml.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : await import("playwright");
const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" };
const DB = process.env.STACK_DB ?? "stackdb";
const sql = (q) => {
  const r = spawnSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", q], { encoding: "utf8", env });
  if (r.status !== 0) throw new Error((r.stderr || "psql").split("\n").filter((l) => /ERROR|DETAIL/.test(l)).join(" · "));
  return r.stdout.trim();
};

const problems = [];
const ok = (m) => console.log("✅ " + m);
const must = (cond, m, got) => { if (cond) ok(m); else { problems.push(m); console.log(`❌ ${m}${got !== undefined ? ` — на екрані: «${String(got).slice(0, 240)}»` : ""}`); } };

const mgr = sql("select email from auth.users where email like 'maria-%@lingua.test' order by created_at desc limit 1");
const tut = sql("select email from auth.users where email like 'iryna-%@lingua.test' order by created_at desc limit 1");
if (!mgr || !tut) { console.log("❌ немає школи проходів — спершу school-walk.mjs"); process.exit(1); }

// 1. Учениця з ціною в євро (якщо її ще немає на цьому стенді)
if (sql("select count(*) from profiles where last_name = 'Єврова'") === "0") {
  sql(`DO $$
  DECLARE mgr uuid := (SELECT id FROM auth.users WHERE email = '${mgr}');
          tut uuid := (SELECT id FROM auth.users WHERE email = '${tut}');
          s uuid := gen_random_uuid(); subj text; i int;
  BEGIN
    SELECT coalesce(subjects[1], 'Англійська') INTO subj FROM tutor_details WHERE user_id = tut;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role','authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO profiles (id, first_name, last_name, is_pending) VALUES (s, 'Єва', 'Єврова', true);
    INSERT INTO profile_contacts (user_id, email) VALUES (s, 'eva-' || left(s::text, 6) || '@fam.test');
    INSERT INTO user_roles (user_id, role) VALUES (s, 'student');
    INSERT INTO student_rates (tutor_id, student_id, subject, price_per_lesson, currency) VALUES (tut, s, subj, 14, 'EUR');
    FOR i IN 1..3 LOOP
      INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
      VALUES (tut, s, subj, now() - (i || ' days')::interval, 60, mgr, 'hub', 'scheduled');
    END LOOP;
    INSERT INTO lessons (tutor_id, student_id, subject, starts_at, duration_minutes, created_by, source, status)
      VALUES (tut, s, subj, now() + interval '2 days', 60, mgr, 'hub', 'scheduled');
    UPDATE lessons SET status = 'completed' WHERE student_id = s AND starts_at < now();
    UPDATE lesson_details d SET student_payment_status = 'paid', student_paid_at = now()
     WHERE d.lesson_id = (SELECT id FROM lessons WHERE student_id = s AND status = 'completed' ORDER BY starts_at LIMIT 1);
    PERFORM set_config('role', 'postgres', true);
  END $$;`);
}
// Що в базі: борг у євро, борг у гривні, виплати до сплати (вони без валюти — валюта школи)
const hubTutors = `(select tutor_id from tutor_workspace_settings where hub_id = (select hub_id from hub_managers hm join auth.users u on u.id = hm.user_id where u.email = '${mgr}'))`;
const [eurDebt, uahDebt, payoutDue, payout1] = sql(`
  select coalesce(sum(d.student_price) filter (where l.status = 'completed' and d.student_payment_status is distinct from 'paid' and cur.c = 'EUR'), 0)::int || '|' ||
         coalesce(sum(d.student_price) filter (where l.status = 'completed' and d.student_payment_status is distinct from 'paid' and cur.c <> 'EUR'), 0)::int || '|' ||
         -- виплати — по ВСІХ уроках школи, разом із груповими (у них немає student_id)
         (select coalesce(sum(d2.tutor_payout), 0)::int from lessons l2 join lesson_details d2 on d2.lesson_id = l2.id
           where l2.tutor_id in ${hubTutors} and coalesce(d2.tutor_payout, 0) > 0 and d2.tutor_payout_status is distinct from 'paid'
             and (l2.status = 'completed' or (l2.status = 'scheduled' and l2.starts_at <= now()))) || '|' ||
         coalesce(max(d.tutor_payout) filter (where p.last_name = 'Єврова'), 0)::int
  from lessons l join lesson_details d on d.lesson_id = l.id
  left join profiles p on p.id = l.student_id
  left join lateral (select coalesce((select r.currency from student_rates r where r.tutor_id = l.tutor_id and r.student_id = l.student_id and r.archived_at is null order by r.created_at desc limit 1), 'UAH') as c) cur on true
  where l.student_id is not null and l.tutor_id in ${hubTutors}`).split("|").map(Number);
must(eurDebt === 28 && payout1 > 0, `у базі: учениця винна ${eurDebt} € (2 уроки по 14 €), виплата за її урок — ${payout1} у валюті школи; решта учнів винні ${uahDebt} ₴; школа винна репетиторам ${payoutDue} ₴`);

const browser = await chromium.launch();
async function session(email) {
  const s = await (await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "x" }) })).json();
  if (!s.access_token) throw new Error("вхід не вдався: " + email);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "uk-UA", timezoneId: "Europe/Kyiv" });
  await ctx.route(/clarity\.ms|facebook\.(com|net)|fbevents|google-analytics|googletagmanager|doubleclick/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`помилка JS: ${String(e.message).slice(0, 160)}`));
  page.on("response", (r) => { if (r.status() >= 400 && /\/rest\/v1\//.test(r.url())) problems.push(`${r.status()} ${r.url().split("/rest/v1")[1].slice(0, 90)}`); });
  await page.goto(BASE + "/terms");
  await page.evaluate((v) => { localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)); localStorage.setItem("i18nextLng", "uk"); localStorage.setItem("cookie_consent", "accepted"); }, s);
  return {
    open: async (path) => {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await wait(2500);
      return (await page.locator("body").innerText()).replace(/[\s  ]+/g, " ");
    },
    close: () => ctx.close(),
  };
}
const n = (v) => v.toLocaleString("uk-UA").replace(/[  ]/g, " ");

// 2. Менеджерка школи
const m = await session(mgr);
let t = await m.open("/finances");
let x = t.match(/Учні винні ([^В]{1,40})Винні репетиторам ([^О]{1,30})/);
must(x && x[1].includes("€28") && !/28 ₴/.test(x[1]), "«Фінанси»: «Учні винні» показує борг учениці як €28, не «28 ₴»", x ? x[0] : t.slice(0, 300));
must(x && (uahDebt === 0 ? !x[1].includes("₴") : x[1].includes(`${n(uahDebt)} ₴`)), `«Фінанси»: гривневий борг решти учнів (${n(uahDebt)} ₴) стоїть окремо, не складений з євро`, x ? x[1] : "");
must(x && x[2].trim() === `${n(payoutDue)} ₴`, `«Фінанси»: «Винні репетиторам ${n(payoutDue)} ₴» — одна сума у валюті школи, без «€»`, x ? x[2] : "");
x = t.match(/Очікувані платежі ([^Ц⚠]{1,40})/);
must(x && x[1].includes("€14"), "«Фінанси»: майбутній урок учениці — в очікуваних платежах як €14, окремо від гривні", x ? x[0] : "рядка немає");
x = t.match(/Прибуток ([^У]{1,40})Учні винні/);
must(x && x[1].includes("€14"), "«Фінанси»: отримані 14 € стоять у прибутку окремо, а не як «14 ₴»", x ? x[0] : "рядка немає");

// Аналітика школи порівнює оплату учня з виплатою: урок у євро з виплатою в гривні давав
// «маржа −2042 %». Такі уроки в неї не входять, і екран каже це словами.
x = t.match(/Маржа по репетиторах.{0,200}/);
const pcts = x ? [...x[0].matchAll(/(-?[\d\s.,]+)%/g)].map((p) => Number(p[1].replace(/\s/g, "").replace(",", "."))) : [];
must(pcts.every((p) => p >= -100 && p <= 100), "«Фінанси», маржа по репетиторах: рахується лише з уроків у валюті школи (було «−2042 %»)", x ? x[0] : "таблиці немає");
must(/у цю аналітику не входять/.test(t) && /Уроки з оплатою в €/.test(t), "«Фінанси»: аналітика каже словами, що уроки в € у неї не входять", (t.match(/Уроки з оплатою.{0,120}/) || ["рядка немає"])[0]);

t = await m.open("/schedule");
x = t.match(/Єва Єврова[^Є]{0,120}/);
must(x && x[0].includes("€14") && x[0].includes(`${n(payout1)} ₴`) && !x[0].includes(`€${payout1}`), `«Розклад», картка уроку: учениця — €14, виплата репетиторці — ${n(payout1)} ₴ (не «€${payout1}»)`, x ? x[0] : t.slice(0, 200));

t = await m.open("/dashboard");
x = t.match(/ПРИБУТОК ([^ ]{1,14}(?: [^ ]{1,6}){0,5})/i);
must(x && x[1].includes("€14") && !/^14 ₴/.test(x[1]), "«Мій день»: прибуток не складає євро з гривнями", x ? x[0] : t.slice(0, 200));
await m.close();

// 3. Репетиторка школи: лише своя виплата у валюті школи, жодного «€» і жодної ціни учня
const tu = await session(tut);
t = await tu.open("/schedule");
x = t.match(/Єва Єврова[^Є]{0,90}/);
must(x && x[0].includes(`${n(payout1)} ₴`) && !x[0].includes("€"), `репетиторка школи: за урок учениці бачить свою виплату ${n(payout1)} ₴ і не бачить ціни в євро`, x ? x[0] : t.slice(0, 200));
await tu.close();

await browser.close();
const uniq = [...new Set(problems)];
if (uniq.length) { console.log("\n❌ прохід «учениця платить у євро» — збої:\n   " + uniq.slice(0, 12).join("\n   ")); process.exit(1); }
console.log("\n✅ прохід «учениця платить у євро» — гроші учня у валюті пари, виплати у валюті школи, нічого не складено в одне число");
