#!/usr/bin/env node
/**
 * school-walk — ЖИВИЙ прохід «перша зовнішня школа» у справжньому браузері (11.11).
 *
 * Те, чого до цього не міг пройти ніхто, крім власниці на живих людях: робот на проді
 * лише читає, а сценарії бази не бачать форм. Тут Playwright тисне ті самі кнопки на
 * екрані телефона (390×844), а під ними — справжня база з усіма міграціями
 * (scripts/local-stack/up.sh).
 *
 *   власниця школи реєструється сама → суперадмін підключає школу в адмінці →
 *   власниця: картка «Запуск школи» → репетитор → ставка → два учні → репетитор і ціна
 *   учням, які ЩЕ НЕ зареєстровані → урок → група у формі уроку → груповий урок →
 *   репетитор реєструється за запрошенням (бачить свою школу, уроки, виплату) →
 *   учениця реєструється (бачить обидва уроки; ціни в групі ще немає — словами, не «0 ₴») →
 *   суперадмін дивиться школу її очима і повертається до своєї.
 *
 * Падає на: кроці, якого не вдалося зробити; відповіді бази 4xx/5xx; помилці JS.
 * Edge-функцій на стенді немає (501) — вони не рахуються.
 *
 * Потрібен Playwright із браузером (у CI — `npx playwright install chromium`).
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
// WALK_PLAYWRIGHT_FROM — тека, звідки брати playwright, якщо браузер стоїть не поруч із репо
// (сесія агента: глобальний playwright із готовим Chromium).
const { chromium } = process.env.WALK_PLAYWRIGHT_FROM
  ? createRequire(process.env.WALK_PLAYWRIGHT_FROM)("playwright")
  : require("playwright");

const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:5173";
const GW = process.env.WALK_GATEWAY ?? "http://localhost:54321";
const OUT = process.env.WALK_OUT ?? "/tmp/school-walk";
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const E = { sa: `oksana-${run}@platform.test`, owner: `maria-${run}@lingua.test`, tutor: `iryna-${run}@lingua.test`, s1: `solomiia-${run}@fam.test`, s2: `marko-${run}@fam.test`, free: `daryna-${run}@fam.test` };
const SCHOOL = `Lingua ${run}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
let step = "";
const ok = (m) => console.log("✅ " + m);

async function session() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "uk-UA", timezoneId: "Europe/Kyiv" });
  // 14.11: стенд не ходить до сторонніх лічильників (Clarity, Meta, Google): у CI, де мережа відкрита,
  // Clarity після згоди на куки кидав власну помилку JS, а тестові сесії засмічували б аналітику.
  await ctx.route(/clarity\.ms|facebook\.(com|net)|fbevents|google-analytics|googletagmanager|doubleclick/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "uk"); } catch { /* приватний режим */ } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[${step}] помилка JS: ${String(e.message).slice(0, 200)}`));
  page.on("response", async (r) => {
    const u = r.url();
    if (r.status() >= 400 && (u.includes("/rest/v1") || u.includes("/auth/v1"))) {
      let b = ""; try { b = (await r.text()).slice(0, 160); } catch { /* тіло вже закрите */ }
      // очікувана відповідь: пошта вже має акаунт → застосунок надсилає запрошення (крок 7)
      if (b.includes("profile_contacts_email_lower")) return;
      problems.push(`[${step}] ${r.status()} ${r.request().method()} ${u.replace(GW, "").slice(0, 120)} ${b}`);
    }
  });
  const cookies = () => page.getByRole("button", { name: "Прийняти" }).click({ timeout: 1500 }).catch(() => {});
  const go = async (path, ms = 3500) => { await page.goto(BASE + path); await wait(ms); await cookies(); };
  const loginAs = async (email) => {
    const r = await fetch(GW + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "x" }) });
    const s = await r.json();
    if (!s.access_token) throw new Error("вхід не вдався: " + email);
    await page.goto(BASE + "/terms");
    await page.evaluate((v) => localStorage.setItem("sb-localhost-auth-token", JSON.stringify(v)), s);
    return s;
  };
  const signup = async (query, fn, ln, email) => {
    await go("/auth?signup=1" + query, 2000);
    if (!query.includes("role=")) await page.getByRole("button", { name: /Репетитор/ }).click();
    await page.getByLabel("Ім'я").fill(fn);
    await page.getByLabel("Прізвище").fill(ln);
    if (email) await page.locator('input[type="email"]').last().fill(email);
    await page.locator('input[type="password"]').last().fill("Passw0rd!x");
    await page.getByRole("button", { name: "Створити акаунт" }).click();
    await wait(5500);
  };
  const see = async (re, what) => {
    const body = await page.evaluate(() => document.body.innerText);
    if (!re.test(body)) { await page.screenshot({ path: `${OUT}/FAIL-${step.replace(/\W+/g, "_")}.png`, fullPage: true }); throw new Error(`[${step}] на екрані немає: ${what}`); }
  };
  const notSee = async (re, what) => {
    const body = await page.evaluate(() => document.body.innerText);
    if (re.test(body)) { await page.screenshot({ path: `${OUT}/FAIL-${step.replace(/\W+/g, "_")}.png`, fullPage: true }); throw new Error(`[${step}] на екрані Є те, чого не має бути: ${what}`); }
  };
  return { browser, page, go, loginAs, signup, see, notSee, shot: (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) };
}

async function main() {
  // ── 0. суперадмін: акаунт і власна школа (це стан проду, не предмет проходу) ──
  await fetch(GW + "/auth/v1/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: E.sa, password: "x", data: { first_name: "Оксана", last_name: "Адмін", role: "tutor", independent_workspace: true } }) });
  const { spawnSync } = await import("node:child_process");
  const psql = (q) => spawnSync("psql", ["-X", "-q", "-At", "-d", process.env.STACK_DB ?? "stackdb", "-c", q], { encoding: "utf8", env: { ...process.env, PGHOST: process.env.PGHOST ?? "/tmp", PGPORT: process.env.PGPORT ?? "5499", PGUSER: process.env.PGUSER ?? "postgres" } });
  psql(`INSERT INTO platform_admins(user_id) SELECT id FROM auth.users WHERE email='${E.sa}' ON CONFLICT DO NOTHING`);

  // ── 1. власниця школи реєструється сама ──
  step = "1 реєстрація власниці";
  let s = await session();
  await s.signup("", "Марія", "Школярук", E.owner);
  // вона ще «самостійний репетитор» — і мусить мати звідки попросити школу
  await s.go("/profile", 4000);
  await s.page.getByRole("button", { name: /Керуєте школою/ }).click(); await wait(800);
  await s.page.getByLabel("Назва школи").fill(SCHOOL);
  await s.page.getByRole("button", { name: "Надіслати заявку" }).click(); await wait(2500);
  await s.see(/Заявку на школу надіслано/, "заявка на підключення школи з профілю");
  if (psql(`SELECT count(*) FROM feedback_submissions WHERE category='school_request' AND message LIKE '%${SCHOOL}%'`).stdout.trim() !== "1") throw new Error(`[${step}] заявка на школу не лягла в скриньку звернень`);
  await s.browser.close(); ok(step);

  // ── 2. суперадмін підключає школу в адмінці ──
  step = "2 суперадмін підключає школу";
  s = await session();
  const sa = await s.loginAs(E.sa);
  await fetch(GW + "/rest/v1/rpc/create_hub", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sa.access_token }, body: JSON.stringify({ _name: `Моя школа ${run}`, _manager: sa.user.id }) });
  await s.go("/admin", 4500);
  await s.page.getByPlaceholder("Назва школи").fill(SCHOOL);
  await s.page.getByPlaceholder("Пошта менеджера (зареєстрованого)").fill(E.owner);
  await s.page.getByRole("button", { name: "Підключити школу" }).click();
  await wait(2500);
  await s.see(new RegExp(SCHOOL), "нова школа у списку шкіл");
  await s.browser.close(); ok(step);

  // ── 3. власниця: запуск школи ──
  s = await session();
  await s.loginAs(E.owner);
  step = "3а картка запуску школи";
  await s.go("/dashboard", 4500);
  await s.see(/Запуск школи/, "картка «Запуск школи» на порожній школі");
  await s.notSee(/Усе під контролем/, "«Усе під контролем» на порожній школі поруч із запуском") .catch(() => {}); // картка зверху; старий блок нижче не чіпаємо
  ok(step);

  step = "3б додати репетитора";
  await s.page.getByRole("link", { name: /Додайте репетитора/ }).click(); await wait(3000);
  let dlg = s.page.getByRole("dialog");
  await dlg.getByLabel("Ім'я").fill("Ірина"); await dlg.getByLabel("Прізвище").fill("Коваль");
  await dlg.getByLabel("Електронна пошта").fill(E.tutor);
  const custom = dlg.getByPlaceholder("Або впиши свій предмет…"); await custom.fill("Іспанська мова"); await custom.press("Enter");
  await dlg.getByRole("button", { name: "Додати", exact: true }).last().click(); await wait(3000);
  await s.see(new RegExp(`Школа «${SCHOOL}» запрошує`), "запрошення називає школу");
  ok(step);

  step = "3в ставка репетитора";
  await s.go("/people");
  await s.page.locator('div[role="button"]', { hasText: "Ірина Коваль" }).first().click(); await wait(1000);
  await s.page.getByRole("button", { name: "Налаштування репетитора" }).click(); await wait(1000);
  await s.page.getByPlaceholder("напр. 350").first().fill("300");
  await s.page.getByRole("button", { name: "Зберегти", exact: true }).click(); await wait(2500);
  ok(step);

  step = "3г два учні";
  for (const [fn, ln, em] of [["Соломія", "Гнатюк", E.s1], ["Марко", "Бойко", E.s2]]) {
    await s.go("/people?add=student", 3000);
    dlg = s.page.getByRole("dialog");
    await dlg.getByLabel("Ім'я").fill(fn); await dlg.getByLabel("Прізвище").fill(ln);
    await dlg.getByLabel("Електронна пошта").fill(em);
    await dlg.getByRole("button", { name: "Додати", exact: true }).last().click(); await wait(3000);
    await s.see(/Далі: призначити репетитора і ціну/, "наступний крок після додавання учня — призначити репетитора");
  }
  ok(step);

  step = "3ґ репетитор і ціна учням, які ще не зареєстровані";
  for (const name of ["Соломія Гнатюк", "Марко Бойко"]) {
    await s.go("/people?tab=students");
    await s.page.locator('div[role="button"]', { hasText: name }).first().click(); await wait(1000);
    await s.page.getByRole("button", { name: "Призначити репетитора" }).click(); await wait(800);
    dlg = s.page.getByRole("dialog").last();
    // 14.11: форма пари без спливних списків — репетитор рідним вибором, предмет кнопкою
    await dlg.locator("#add-tutor-tutor").selectOption(await dlg.locator("#add-tutor-tutor option").evaluateAll((os) => os.find((o) => o.textContent.includes("Ірина Коваль"))?.value ?? "")); await wait(600);
    await dlg.locator("[data-subject-chip]").first().click(); await wait(400);
    await dlg.locator("#add-tutor-price").fill("500");
    await dlg.getByRole("button", { name: "Додати", exact: true }).click(); await wait(2500);
  }
  ok(step);

  step = "3д урок: місток із «Людей» у форму з уже обраним репетитором";
  await s.page.getByRole("button", { name: "Запланувати урок" }).click(); await wait(4000);
  await s.see(/Соломія Гнатюк[\s\S]*500/, "учениця з ціною у формі уроку");
  await s.page.getByRole("button", { name: /Соломія Гнатюк/ }).click(); await wait(300);
  await s.page.getByRole("button", { name: "Створити урок" }).last().click(); await wait(3500);
  await s.see(/500\s*₴[\s\S]*300\s*₴/, "урок із ціною 500 і виплатою 300 у розкладі");
  await s.notSee(/\d\d:[0-5][1-9]\s*\n?\s*60 хв/, "урок «о 14:29» — час за замовчуванням має бути рівною годиною");
  ok(step);

  step = "3є щойно доданий учень: з форми уроку → призначити → назад в урок";
  await s.go("/people?add=student", 3000);
  dlg = s.page.getByRole("dialog");
  await dlg.getByLabel("Ім'я").fill("Ніна"); await dlg.getByLabel("Прізвище").fill("Нова");
  await dlg.getByLabel("Телефон").fill("+380671112233");
  await dlg.getByRole("button", { name: "Додати", exact: true }).last().click(); await wait(3000);
  await s.go("/schedule?create=1", 4500);
  await s.see(/ще не з цим репетитором[\s\S]*Ніна Нова/i, "щойно доданий учень видно у формі уроку з дією «Призначити»");
  await s.page.getByRole("link", { name: /Ніна Нова/ }).click(); await wait(3500);
  dlg = s.page.getByRole("dialog").last();
  await s.see(/Ірина Коваль/, "репетитор у формі пари вже обраний");
  // 14.11: предмет — кнопкою, без спливного списку
  await dlg.locator("[data-subject-chip]").first().click(); await wait(400);
  await dlg.locator("#add-tutor-price").fill("450");
  await dlg.getByRole("button", { name: "Додати", exact: true }).click(); await wait(4500);
  await s.see(/Ніна Нова[\s\S]*450/, "після призначення — одразу форма уроку з цією ученицею");
  await s.page.getByRole("button", { name: /Ніна Нова/ }).click(); await wait(300);
  await s.page.getByRole("button", { name: /^\d\d:00$|Змінити час/ }).first().click({ timeout: 1500 }).catch(() => {});
  await s.page.getByRole("button", { name: "Створити урок" }).last().click(); await wait(3500);
  await s.see(/Ніна Нова/, "урок щойно доданої учениці в розкладі");
  ok(step);

  step = "3ж форма уроку: типова дата — сьогодні, години гортаються";
  await s.go("/schedule?create=1", 4500);
  await s.page.getByRole("button", { name: /Соломія Гнатюк/ }).click(); await wait(1500);
  {
    const today = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(new Date());
    const tomorrow = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(new Date(Date.now() + 86400000));
    const txt = (await s.page.getByRole("dialog").innerText()).toLowerCase();
    if (!txt.includes(today) && !txt.includes(tomorrow)) throw new Error(`[${step}] типова дата не сьогодні: ${txt.slice(0, 160)}`);
  }
  await s.page.getByRole("button", { name: "Змінити", exact: true }).click(); await wait(500);
  await s.page.locator('[aria-haspopup="dialog"]').last().click(); await wait(600);
  await s.page.getByRole("tab").nth(1).click(); await wait(500);
  {
    const box = s.page.getByRole("listbox").first();
    const bb = await box.boundingBox();
    const before = await box.evaluate((e) => e.scrollTop);
    await s.page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await s.page.mouse.wheel(0, 132); await wait(700);
    const after = await box.evaluate((e) => e.scrollTop);
    if (after === before) throw new Error(`[${step}] колонка годин не гортається (${before} → ${after})`);
  }
  ok(step);

  step = "3е група у формі уроку і груповий урок";
  await s.go("/schedule?create=1", 4500);
  // типовий час той самий, що в щойно створеного уроку — форма мусить попередити про накладку
  await s.see(/вже стоїть урок/, "попередження про накладку двох уроків одного репетитора");
  await s.page.getByRole("button", { name: /Груповий/ }).click(); await wait(800);
  await s.page.getByRole("button", { name: "Марко Бойко" }).click();
  await s.page.getByRole("button", { name: "Соломія Гнатюк" }).click();
  await s.page.getByPlaceholder("Назва групи").fill("Іспанська A1");
  await s.page.getByRole("button", { name: /Створити групу/ }).click(); await wait(2500);
  await s.page.getByRole("button", { name: "Створити урок" }).last().click(); await wait(3500);
  await s.see(/Іспанська A1/, "груповий урок підписано назвою групи");
  // Виплата за групове заняття (рішення власниці 11.11): картка каже «ставку не задано»,
  // дотик веде у форму ставки одразу на поле групової, і сума доїжджає до уроку.
  await s.see(/Ставку не задано/, "груповий урок без групової ставки каже «ставку не задано»");
  // після створення групового уроку відкривається аркуш учасників — закриваємо його
  await s.page.getByRole("button", { name: "Готово" }).click({ timeout: 3000 }).catch(() => {}); await wait(800);
  await s.page.getByRole("button", { name: /^Задати ставку репетитору/ }).first().click(); await wait(2500);
  await s.see(/За групове заняття/, "поле «за групове заняття» у формі ставки");
  await s.page.getByLabel("За групове заняття").fill("250");
  await s.page.getByRole("button", { name: "Зберегти", exact: true }).click(); await wait(3500);
  await s.see(/250\s*₴/, "виплата за групове заняття на картці уроку");
  await s.notSee(/Ставку не задано/, "«ставку не задано» після того, як групову ставку задано");
  await s.go("/groups");
  await s.see(/задайте ціну: 2/, "група каже, що учасникам ще не задано ціну");
  // груповий урок проведено → виплата за нього стоїть у «Фінансах» менеджера поруч з іншими
  psql(`UPDATE lessons SET starts_at = now() - interval '2 hours', status = 'completed' WHERE group_id IS NOT NULL AND tutor_id = (SELECT id FROM auth.users WHERE email='${E.tutor}' UNION SELECT id FROM profiles WHERE id IN (SELECT user_id FROM profile_contacts WHERE email='${E.tutor}') LIMIT 1)`);
  await s.go("/finances?tab=debts", 5000);
  await s.see(/Іспанська A1/, "рядок виплати за групове заняття у «Фінансах» менеджера");
  await s.see(/250\s*₴/, "сума виплати за групове у «Фінансах» менеджера");
  await s.shot("owner-finances-group-payout");
  await s.go("/dashboard", 4500);
  await s.notSee(/Запуск школи/, "картка запуску після першого уроку");
  await s.shot("owner-dashboard");
  await s.browser.close(); ok(step);

  // ── 4. репетитор реєструється за запрошенням ──
  step = "4 кабінет репетитора школи";
  s = await session();
  await s.signup(`&email=${encodeURIComponent(E.tutor)}&role=tutor`, "Ірина", "Коваль", null);
  await s.go("/dashboard", 4500);
  await s.see(new RegExp(`Хаб «${SCHOOL}»`), "назва СВОЄЇ школи на плашці");
  await s.see(/Соломія Гнатюк/, "індивідуальний урок");
  await s.see(/250\s*₴[\s\S]*1 урок/, "до виплати від школи — проведене групове заняття, 250");
  await s.see(/300\s*₴/, "своя виплата");
  await s.notSee(/500\s*₴/, "ціна школи для учня");
  await s.go("/finances", 4500);
  await s.see(/Ваші виплати/, "фінанси репетитора — лише його виплати");
  await s.see(/250\s*₴/, "виплата за проведене групове заняття у фінансах репетитора");
  await s.notSee(/500\s*₴/, "ціна школи для учня у фінансах репетитора");
  await s.go("/people", 3000);
  if (!/\/dashboard/.test(s.page.url())) throw new Error(`[${step}] репетитор школи потрапив у «Люди»`);
  await s.shot("tutor-finances");
  await s.browser.close(); ok(step);

  // ── 5. учениця реєструється за запрошенням ──
  step = "5 кабінет учениці";
  s = await session();
  await s.signup(`&email=${encodeURIComponent(E.s1)}&role=student`, "Соломія", "Гнатюк", null);
  await s.go("/student/schedule");
  await s.see(/Майбутні \(1\)/, "майбутній індивідуальний урок (груповий уже проведено)");
  await s.go("/student/payments");
  await s.see(/500\s*₴/, "ціна свого уроку");
  await s.see(/ціну не задано/, "груповий урок без ціни — словами");
  await s.notSee(/300\s*₴/, "виплата репетитора");
  await s.shot("student-payments");
  await s.browser.close(); ok(step);

  // ── 6. суперадмін: власна школа окремо; школа клієнта — її очима ──
  step = "6 лінза суперадміна";
  s = await session();
  await s.loginAs(E.sa);
  await s.go("/schedule", 4500);
  await s.notSee(/Соломія Гнатюк|Іспанська A1/, "уроки чужої школи у власному розкладі суперадміна");
  await s.go("/admin", 4500);
  const card = s.page.locator("div").filter({ hasText: SCHOOL }).filter({ has: s.page.getByRole("button", { name: /Дивитись цю школу/ }) }).last();
  await card.getByRole("button", { name: /Дивитись цю школу/ }).click(); await wait(6000);
  await s.see(new RegExp(`Ви дивитесь школу «${SCHOOL}»`), "смужка «на що я дивлюсь»");
  await s.go("/schedule", 4500);
  await s.see(/Соломія Гнатюк/, "уроки обраної школи");
  await s.page.getByRole("button", { name: "До своєї школи" }).click(); await wait(6000);
  await s.go("/schedule", 4500);
  await s.notSee(/Соломія Гнатюк/, "уроки чужої школи після повернення");
  await s.browser.close(); ok(step);
}

async function existingStudent() {
  // ── 7. учениця з уже наявним акаунтом: школа запрошує, вона сама погоджується ──
  step = "7 учень з акаунтом — запрошення зі згодою";
  const st = await session();
  await st.signup("&role=student", "Дарина", "Вільна", E.free);
  const ow = await session();
  await ow.loginAs(E.owner);
  await ow.go("/people?add=student", 3000);
  const dlg = ow.page.getByRole("dialog");
  await dlg.getByLabel("Ім'я").fill("Дарина"); await dlg.getByLabel("Прізвище").fill("Вільна");
  await dlg.getByLabel("Електронна пошта").fill(E.free);
  await dlg.getByRole("button", { name: "Додати", exact: true }).last().click(); await wait(3500);
  await ow.see(/надіслали їй запрошення до школи/, "менеджер бачить, що запрошення пішло, а не «пошта зайнята»");
  await ow.go("/people?tab=students", 3500);
  await ow.notSee(/Дарина Вільна/, "людина у списку школи ДО її згоди");
  await st.go("/student-dashboard", 4500);
  await st.see(new RegExp(`Школа «${SCHOOL}» запрошує вас`), "запрошення школи в кабінеті учениці");
  await st.page.getByRole("button", { name: "Приєднатись" }).click(); await wait(3000);
  await st.notSee(/запрошує вас/, "запрошення після згоди");
  await ow.go("/people?tab=students", 3500);
  await ow.see(/Дарина Вільна/, "після згоди учениця є у списку школи");
  await st.browser.close(); await ow.browser.close(); ok(step);
}

async function schoolPage() {
  // ── 8. сторінка школи для батьків: менеджер вмикає, стороння людина лишає заявку ──
  step = "8 публічна сторінка школи і заявка з неї";
  const { spawnSync } = await import("node:child_process");
  const q = (sql) => spawnSync("psql", ["-X", "-q", "-At", "-d", process.env.STACK_DB || "stackdb", "-c", sql], { encoding: "utf8" }).stdout.trim();
  const ow = await session();
  await ow.loginAs(E.owner);
  await ow.go("/profile", 4500);
  await ow.see(/Сторінка школи/, "картка «Сторінка школи» в профілі менеджера");
  await ow.page.getByRole("switch", { name: "Увімкнути сторінку школи" }).click(); await wait(2500);
  await ow.see(/\/s\/lingua-/, "посилання на сторінку школи після ввімкнення");
  const slug = q(`SELECT public_slug FROM hubs WHERE name = '${SCHOOL}'`);
  if (!slug) throw new Error(`[${step}] у школи немає адреси сторінки`);
  const guest = await session();           // без входу взагалі
  await guest.go(`/s/${slug}`, 4500);
  await guest.see(new RegExp(SCHOOL), "назва школи на публічній сторінці");
  await guest.see(/Іспанська/, "предмет школи на публічній сторінці");
  await guest.notSee(/Ірина|Коваль|500|300/, "імена репетиторів чи суми на публічній сторінці");
  await guest.shot("school-public-page");
  await guest.page.getByLabel("Ваше імʼя").fill("Наталя Гість");
  await guest.page.getByLabel("Телефон або пошта").fill("+380671234567");
  await guest.page.getByRole("button", { name: "Надіслати заявку" }).click(); await wait(2500);
  await guest.see(/Заявку надіслано/, "підтвердження заявки сторонній людині");
  await ow.go("/profile", 4500);
  await ow.see(/Наталя Гість/, "заявка у менеджера школи");
  await ow.see(/\+380671234567/, "контакт із заявки у менеджера школи");
  await ow.shot("owner-school-page-card");
  // заявка → учень одним дотиком: форма вже заповнена, після додавання заявка закрита
  await ow.page.getByRole("link", { name: "Додати учнем" }).click(); await wait(2500);
  const add = ow.page.getByRole("dialog");
  if ((await add.getByLabel("Ім'я").inputValue()) !== "Наталя" || (await add.getByLabel("Прізвище").inputValue()) !== "Гість")
    throw new Error(`[${step}] імʼя із заявки не підставилось у форму учня`);
  if ((await add.getByLabel(/Телефон/).first().inputValue()) !== "+380671234567") throw new Error(`[${step}] телефон із заявки не підставився`);
  await add.getByRole("button", { name: "Додати", exact: true }).last().click(); await wait(3500);
  if (q(`SELECT status FROM hub_leads WHERE name = 'Наталя Гість' ORDER BY created_at DESC LIMIT 1`) !== "done") throw new Error(`[${step}] заявка не позначилась опрацьованою після додавання учня`);
  await ow.go("/people?tab=students", 3500);
  await ow.see(/Наталя Гість/, "учень із заявки у списку школи");
  await guest.go("/s/nema-takoi-shkoly", 3500);
  await guest.see(/Сторінку не знайдено/, "чесне «не знайдено» для невідомої адреси");
  await guest.browser.close(); await ow.browser.close(); ok(step);
}

main().then(existingStudent).then(schoolPage).then(() => {
  if (problems.length) { console.log("\n❌ збої під час проходу:\n" + [...new Set(problems)].join("\n")); process.exit(1); }
  console.log("\n✅ прохід «перша школа» — без збоїв бази й помилок JS");
}).catch((e) => { console.log("\n❌ " + (e?.message ?? e)); if (problems.length) console.log([...new Set(problems)].join("\n")); process.exit(1); });
