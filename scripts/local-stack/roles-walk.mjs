#!/usr/bin/env node
/**
 * roles-walk — ЖИВИЙ прохід «сіткою по ролях» у справжньому браузері (13.11).
 *
 * school-walk проходить шлях НОВОЇ школи. Тут — щоденні шляхи тих, хто вже працює,
 * кожен під своєю роллю, з грошима до кінця:
 *   А. власниця платформи (суперадмін + менеджер ВЛАСНОЇ школи): репетитор → ставка →
 *      учень лише з телефоном → репетитор і ціна → урок → проведено → оплата учня →
 *      виплата репетитору; одна й та сама цифра у «Фінансах», на «Моєму дні» і в базі;
 *   Б. репетитор школи: реєстрація за запрошенням → сам ставить урок своєму учневі →
 *      кожен екран без ціни школи й без телефону учня;
 *   В. самостійна репетиторка: реєстрація → два учні → урок → груповий урок → проведено →
 *      оплати (індивідуальна й групові) → «Отримано» однакове у «Фінансах» і на «Моєму дні»,
 *      «Операції» не порожні, у профілі справжня кількість учнів.
 *
 * Запуск: bash scripts/local-stack/up.sh && node scripts/local-stack/roles-walk.mjs
 * (WALK_PLAYWRIGHT_FROM=/tmp/ — якщо браузер стоїть не поруч із репо).
 * Падає на: кроці, якого не вдалося зробити; відповіді бази 4xx/5xx; помилці JS.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = process.env.WALK_PLAYWRIGHT_FROM ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright") : require("playwright");

const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const OUT = process.env.WALK_OUT ?? "/tmp/roles-walk";
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
let step = "";
const ok = () => console.log("✅ " + step);
const psql = (q) => {
  const r = spawnSync("psql", ["-X", "-q", "-At", "-d", process.env.STACK_DB ?? "stackdb", "-c", q], { encoding: "utf8", env: { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" } });
  if (r.status !== 0) throw new Error(`[${step}] psql: ${r.stderr}`);
  return r.stdout.trim();
};
const must = (cond, what) => { if (!cond) throw new Error(`[${step}] ${what}`); };

async function session() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "uk-UA", timezoneId: "Europe/Kyiv" });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "uk"); } catch { /* приватний режим */ } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[${step}] помилка JS: ${String(e.message).slice(0, 200)}`));
  page.on("response", async (r) => {
    const u = r.url();
    if (r.status() >= 400 && (u.includes("/rest/v1") || u.includes("/auth/v1"))) {
      let b = ""; try { b = (await r.text()).slice(0, 160); } catch { /* тіло вже закрите */ }
      problems.push(`[${step}] ${r.status()} ${r.request().method()} ${u.replace(GW, "").slice(0, 120)} ${b}`);
    }
  });
  const text = () => page.evaluate(() => document.body.innerText);
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
  const go = async (path, ms = 3500) => {
    await page.goto(BASE + path); await wait(ms);
    await page.getByRole("button", { name: "Прийняти" }).click({ timeout: 1200 }).catch(() => {});
    // недороблений онбординг перехоплює перший екран — ідемо «до застосунку» і повторюємо
    if (/\/onboarding/.test(page.url()) && !path.startsWith("/onboarding")) {
      await page.getByText(/Зроблю пізніше/).click({ timeout: 3000 }).catch(() => {}); await wait(2500);
      await page.goto(BASE + path); await wait(ms);
    }
  };
  const loginAs = async (email) => {
    const r = await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "x" }) });
    const s = await r.json();
    if (!s.access_token) throw new Error("вхід не вдався: " + email);
    await page.goto(BASE + "/terms");
    await page.evaluate((v) => localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)), s);
    return s;
  };
  const signup = async (query, fn, ln, email) => {
    await page.goto(BASE + "/auth?signup=1" + query); await wait(2000);
    await page.getByRole("button", { name: "Прийняти" }).click({ timeout: 1200 }).catch(() => {});
    if (!query.includes("role=")) await page.getByRole("button", { name: /Репетитор/ }).click();
    await page.getByLabel("Ім'я").fill(fn);
    await page.getByLabel("Прізвище").fill(ln);
    if (email) await page.locator('input[type="email"]').last().fill(email);
    await page.locator('input[type="password"]').last().fill("Passw0rd!x");
    await page.getByRole("button", { name: "Створити акаунт" }).click();
    await wait(5500);
  };
  const see = async (re, what) => { if (!re.test(await text())) { await shot("FAIL-" + step.replace(/\W+/g, "_").slice(0, 40)); throw new Error(`[${step}] на екрані немає: ${what}`); } };
  const notSee = async (re, what) => { if (re.test(await text())) { await shot("FAIL-" + step.replace(/\W+/g, "_").slice(0, 40)); throw new Error(`[${step}] на екрані Є те, чого не має бути: ${what}`); } };
  return { browser, page, go, loginAs, signup, see, notSee, shot, text };
}

const E = { sa: `oksana-${run}@platform.test`, tutor: `petro-${run}@hub.test`, ind: `alina-${run}@tutor.test` };

async function ownerInOwnSchool() {
  await fetch(GW + "/auth/v1/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: E.sa, password: "x", data: { first_name: "Оксана", last_name: "Власниця", role: "tutor", independent_workspace: true } }) });
  psql(`INSERT INTO platform_admins(user_id) SELECT id FROM auth.users WHERE email='${E.sa}' ON CONFLICT DO NOTHING`);
  const s = await session();
  const sa = await s.loginAs(E.sa);
  const r = await fetch(GW + "/rest/v1/rpc/create_hub", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sa.access_token }, body: JSON.stringify({ _name: `Моя школа ${run}`, _manager: sa.user.id }) });
  must(r.ok, "власна школа суперадміна не створилась");

  step = "А1 власниця платформи у власній школі: репетитор і ставка";
  await s.go("/people?add=tutor");
  let dlg = s.page.getByRole("dialog");
  await dlg.getByLabel("Ім'я").fill("Петро"); await dlg.getByLabel("Прізвище").fill("Городній");
  await dlg.getByLabel("Електронна пошта").fill(E.tutor);
  const custom = dlg.getByPlaceholder("Або впиши свій предмет…"); await custom.fill("Математика"); await custom.press("Enter");
  await dlg.getByRole("button", { name: "Додати", exact: true }).last().click(); await wait(3000);
  await s.go("/people");
  await s.page.locator('div[role="button"]', { hasText: "Петро Городній" }).first().click(); await wait(1000);
  await s.page.getByRole("button", { name: "Налаштування репетитора" }).click(); await wait(1000);
  await s.page.getByPlaceholder("напр. 350").first().fill("400");
  await s.page.getByRole("button", { name: "Зберегти", exact: true }).click(); await wait(2500);
  ok();

  step = "А2 учень лише з телефоном → репетитор і ціна → урок";
  await s.go("/people?add=student", 3000);
  dlg = s.page.getByRole("dialog");
  await dlg.getByLabel("Ім'я").fill("Іванка"); await dlg.getByLabel("Прізвище").fill("Мельник");
  await dlg.getByLabel("Телефон").fill("+380501112233");
  await dlg.getByRole("button", { name: "Додати", exact: true }).last().click(); await wait(3000);
  await s.see(/Далі: призначити репетитора і ціну/, "місток після додавання учня без пошти");
  await s.go("/people?tab=students");
  await s.page.locator('div[role="button"]', { hasText: "Іванка Мельник" }).first().click(); await wait(1000);
  await s.page.getByRole("button", { name: "Призначити репетитора" }).click(); await wait(800);
  dlg = s.page.getByRole("dialog").last();
  await dlg.getByRole("combobox").first().click(); await wait(400);
  await s.page.getByRole("option", { name: /Петро Городній/ }).click(); await wait(600);
  await dlg.getByRole("combobox").nth(1).click(); await wait(400);
  await s.page.getByRole("option").first().click(); await wait(500);
  await dlg.locator("input").last().fill("700");
  await dlg.getByRole("button", { name: "Додати", exact: true }).click(); await wait(2500);
  await s.page.getByRole("button", { name: "Запланувати урок" }).click(); await wait(4000);
  await s.page.getByRole("button", { name: /Іванка Мельник/ }).click(); await wait(300);
  await s.page.getByRole("button", { name: "Створити урок" }).last().click(); await wait(3500);
  await s.see(/700\s*₴[\s\S]*400\s*₴/, "урок 700 / виплата 400 у розкладі");
  ok();

  step = "А3 урок проведено: борг учня і виплата — у «Фінансах» і на «Моєму дні»";
  psql(`UPDATE lessons SET starts_at = now() - interval '3 hours', status='completed' WHERE tutor_id IN (SELECT user_id FROM profile_contacts WHERE email='${E.tutor}')`);
  await s.go("/dashboard", 5000);
  await s.see(/Іванка Мельник — борг 700\s*₴/, "задача про борг на «Моєму дні» (без «винен»)");
  await s.see(/1 урок без оплати/, "однина: «1 урок без оплати», а не «1 уроків»");
  await s.go("/finances?tab=debts", 5000);
  await s.see(/Учні винні\s*700\s*₴[\s\S]*Винні репетиторам\s*400\s*₴/, "борг 700 і до виплати 400");
  await s.see(/Цифри звірені з базою/, "звірка з базою");
  ok();

  step = "А4 оплата учня і виплата репетитору: 700 − 400 = 300 всюди";
  await s.page.locator("button", { hasText: "Очікує" }).first().click(); await wait(2500);
  await s.see(/Надходження\s*700\s*₴/, "надходження одразу після позначки оплати");
  await s.page.locator("button", { hasText: "Очікує" }).first().click(); await wait(2500);
  await s.go("/finances", 5000);
  await s.see(/Надходження\s*700\s*₴\s*Виплати\s*400\s*₴\s*Прибуток\s*300\s*₴/, "700 / 400 / 300 у «Фінансах»");
  await s.go("/finances?tab=debts", 4500);
  await s.see(/Чисто! Усі оплатили/, "порожні «Борги» — добра новина, а не «за фільтром нічого»");
  await s.go("/dashboard", 5000);
  await s.see(/ПРИБУТОК\s*300\s*₴/, "прибуток 300 на «Моєму дні»");
  must(psql(`SELECT student_price||'/'||student_payment_status||'/'||tutor_payout||'/'||tutor_payout_status FROM lesson_details d JOIN lessons l ON l.id=d.lesson_id WHERE l.tutor_id IN (SELECT user_id FROM profile_contacts WHERE email='${E.tutor}')`) === "700.00/paid/400.00/paid", "у базі не 700 paid / 400 paid");
  await s.browser.close(); ok();
}

async function hubTutor() {
  step = "Б1 репетитор школи: реєстрація за запрошенням";
  const s = await session();
  await s.signup(`&email=${encodeURIComponent(E.tutor)}&role=tutor`, "Петро", "Городній", null);
  await s.go("/dashboard", 5000);
  await s.see(new RegExp(`Хаб «Моя школа ${run}»`), "назва своєї школи");
  await s.notSee(/700/, "ціна школи на «Моєму дні» репетитора");
  ok();

  step = "Б2 репетитор школи сам ставить урок своєму учневі";
  await s.go("/schedule?create=1", 5000);
  await s.notSee(/700/, "ціна школи у формі уроку");
  await s.page.getByRole("button", { name: /Іванка Мельник/ }).click(); await wait(300);
  await s.page.getByRole("button", { name: "Створити урок" }).last().click(); await wait(3500);
  await s.see(/Заплановано[\s\S]*Іванка Мельник[\s\S]*400\s*₴/, "новий урок із власною виплатою 400");
  must(psql(`SELECT string_agg(l.source||' '||d.student_price||'/'||d.tutor_payout, ',' ORDER BY l.created_at) FROM lessons l JOIN lesson_details d ON d.lesson_id=l.id WHERE l.tutor_id=(SELECT id FROM auth.users WHERE email='${E.tutor}')`) === "hub 700.00/400.00,hub 700.00/400.00", "урок репетитора школи народився без ціни чи виплати школи");
  ok();

  step = "Б3 жоден екран репетитора школи не показує ціни школи чи телефону учня";
  for (const p of ["/schedule", "/finances", "/chats", "/groups", "/profile", "/my-students", "/wallets", "/people"]) {
    await s.go(p, 3800);
    await s.notSee(/700\s*₴|\+380501112233/, `ціна школи або телефон учня на ${p}`);
  }
  await s.go("/finances", 4000);
  await s.see(/ОТРИМАНО\s*400\s*₴/, "отримана виплата 400 у фінансах репетитора");
  await s.go("/profile", 4000);
  await s.see(/1\s*учень/, "у профілі справжня кількість учнів (було завжди «0 учнів»)");
  await s.browser.close(); ok();
}

async function independent() {
  step = "В1 самостійна: реєстрація";
  const s = await session();
  await s.signup("", "Аліна", "Кула", E.ind);
  await s.notSee(/вже зареєстр/, "«email вже зареєстровано» після вдалої реєстрації");
  ok();

  step = "В2 самостійна: два учні";
  for (const [fn, ln, price] of [["Тимур", "Бондар", "500"], ["Таня", "Лисенко", "450"]]) {
    await s.go("/my-students");
    await s.page.getByRole("button", { name: /Додати учня/ }).first().click(); await wait(1200);
    const dlg = s.page.getByRole("dialog");
    await dlg.getByPlaceholder("Анна").fill(fn); await dlg.getByPlaceholder("Іваненко").fill(ln);
    await dlg.getByPlaceholder("Почніть вводити…").fill("Англійська");
    await dlg.getByPlaceholder("500").fill(price);
    await dlg.getByRole("button", { name: /Додати учня/ }).last().click(); await wait(3000);
  }
  await s.go("/my-students");
  await s.see(/Таня Лисенко[\s\S]*450\s*₴\/урок[\s\S]*Тимур Бондар[\s\S]*500\s*₴\/урок/, "обидва учні з цінами");
  ok();

  step = "В3 самостійна: урок і груповий урок";
  await s.go("/schedule?create=1", 4500);
  await s.see(/оберіть учня та час/, "порожній розклад не каже самостійній «оберіть репетитора»");
  await s.page.getByRole("button", { name: /Тимур Бондар/ }).click(); await wait(300);
  await s.page.getByRole("button", { name: "Створити урок" }).last().click(); await wait(3500);
  await s.go("/schedule?create=1", 4500);
  await s.page.getByRole("button", { name: /Груповий/ }).click(); await wait(800);
  await s.page.getByRole("button", { name: "Тимур Бондар" }).click();
  await s.page.getByRole("button", { name: "Таня Лисенко" }).click();
  await s.page.getByPlaceholder("Назва групи").fill("Speaking club");
  await s.page.getByRole("button", { name: /Створити групу/ }).click(); await wait(2500);
  await s.page.getByRole("button", { name: "Створити урок" }).last().click(); await wait(3500);
  await s.see(/Speaking club/, "груповий урок у розкладі");
  ok();

  step = "В4 самостійна: проведено → борги → оплати → одна цифра всюди";
  const tid = psql(`SELECT id FROM auth.users WHERE email='${E.ind}'`);
  psql(`UPDATE lessons SET starts_at = now() - interval '3 hours', status='completed' WHERE tutor_id='${tid}'`);
  psql(`UPDATE lesson_participants SET student_price = 300 WHERE lesson_id IN (SELECT id FROM lessons WHERE tutor_id='${tid}' AND group_id IS NOT NULL)`);
  await s.go("/finances?tab=debts", 5000);
  await s.see(/1\s100\s*₴ не отримано[\s\S]*3 уроки без оплати/, "борг 1100 за три уроки (500 + 300 + 300)");
  await s.notSee(/Виплат|Прибуток/, "виплати чи маржа на екрані самостійної");
  for (let i = 0; i < 3; i++) { await s.page.getByRole("button", { name: "Оплачено" }).first().click(); await wait(2300); }
  await s.go("/finances", 5000);
  await s.see(/ОТРИМАНО\s*1\s100\s*₴/, "отримано 1100 у «Фінансах»");
  await s.see(/\+500\s*₴[\s\S]*\+300\s*₴[\s\S]*\+300\s*₴/, "«Операції» показують оплачені уроки (були порожні, щойно всі оплатили)");
  await s.go("/dashboard", 5000);
  await s.see(/ОТРИМАНО\s*1\s100\s*₴/, "отримано 1100 на «Моєму дні» — разом із груповими");
  await s.notSee(/Репетитор: Аліна Кула/, "«Репетитор: вона сама» на власній картці уроку");
  await s.go("/profile", 4000);
  await s.see(/2\s*учні/, "у профілі 2 учні");
  must(psql(`SELECT (SELECT string_agg(student_payment_status, ',') FROM lesson_details d JOIN lessons l ON l.id=d.lesson_id WHERE l.tutor_id='${tid}' AND l.group_id IS NULL)||'|'||(SELECT string_agg(student_payment_status, ',') FROM lesson_participants p JOIN lessons l ON l.id=p.lesson_id WHERE l.tutor_id='${tid}')`) === "paid|paid,paid", "у базі не всі оплати позначені");
  await s.browser.close(); ok();
}

ownerInOwnSchool().then(hubTutor).then(independent).then(() => {
  if (problems.length) { console.error("\n❌ прохід дійшов до кінця, але були збої:\n  " + problems.join("\n  ")); process.exit(1); }
  console.log("\n✅ прохід «сіткою по ролях» — без збоїв бази й помилок JS");
}).catch((e) => { console.error("\n❌ " + e.message + (problems.length ? "\n  " + problems.join("\n  ") : "")); process.exit(1); });
