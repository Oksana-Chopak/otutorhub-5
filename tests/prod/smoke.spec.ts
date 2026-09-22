import { test, expect, type Page } from "@playwright/test";
import { EDGE_VERSION } from "../../supabase/functions/_shared/version";

/**
 * РОБОТ-СТОРОЖ — перевіряє ЖИВИЙ прод (22.09).
 *
 * Що саме і чому:
 *  1. «Збірка на проді = main» і «edge-функції на проді = репо» — три канали
 *     доставки розʼїжджаються мовчки (§0 спільного контексту); тепер це видно
 *     словами, а не вгадується. У режимі PROD_FRESH=warn (після пушу, до Publish)
 *     розбіжність — попередження; у PROD_FRESH=require (ранкова перевірка) —
 *     провал: минула доба, а прод досі не наздогнав main.
 *  2. Кожна з чотирьох персон логіниться і відкриває свої головні екрани:
 *     жодного ErrorBoundary/ErrorState, жодної необробленої помилки JS і ЖОДНОЇ
 *     відповіді 400/404/5xx від бази чи edge-функцій. Саме 400 від PostgREST —
 *     клас «колонки немає → екран мовчки порожній» (13.09), який ніякі модульні
 *     тести не бачать.
 *
 * Нічого не пише в базу: лише логін і читання. Облікові дані — тестові акаунти.
 */

const SUPABASE_URL = process.env.PROD_SUPABASE_URL ?? "https://kficbcjqcbhqhjimxfed.supabase.co";
const EXPECT_STAMP = (process.env.EXPECT_STAMP ?? "").slice(0, 8);
const EXPECT_SHA = (process.env.EXPECT_SHA ?? "").slice(0, 8);
const FRESH = process.env.PROD_FRESH === "require" ? "require" : "warn";

const ERROR_TEXTS = ["Щось пішло не так", "Не вдалося завантажити", "Something went wrong"];
const CONSOLE_NOISE = /chrome-extension|moz-extension|ERR_BLOCKED_BY_CLIENT|clarity\.ms|facebook|fbevents|favicon|ResizeObserver|Third-party cookie|Permissions policy|was preloaded|net::ERR_|Failed to load resource|\[vite\]|service worker|ServiceWorker|sw\.js/i;

type Persona = { key: string; label: string; email?: string; password?: string; routes: string[] };
const PERSONAS: Persona[] = [
  { key: "ind", label: "самостійний репетитор", email: process.env.TEST_TUTOR_EMAIL, password: process.env.TEST_TUTOR_PASSWORD, routes: ["/dashboard", "/schedule", "/my-students", "/finances", "/profile"] },
  { key: "manager", label: "менеджер школи", email: process.env.TEST_MANAGER_EMAIL, password: process.env.TEST_MANAGER_PASSWORD, routes: ["/dashboard", "/people", "/schedule", "/finances", "/groups"] },
  { key: "hub", label: "хабовий репетитор", email: process.env.TEST_HUB_TUTOR_EMAIL, password: process.env.TEST_HUB_TUTOR_PASSWORD, routes: ["/dashboard", "/schedule", "/finances", "/profile"] },
  { key: "student", label: "учень", email: process.env.TEST_STUDENT_EMAIL, password: process.env.TEST_STUDENT_PASSWORD, routes: ["/student-dashboard", "/student/schedule", "/student/payments", "/student/homework"] },
];

type Watch = { pageErrors: string[]; consoleErrors: string[]; badResponses: string[]; softResponses: string[] };
function watch(page: Page): Watch {
  const w: Watch = { pageErrors: [], consoleErrors: [], badResponses: [], softResponses: [] };
  page.on("pageerror", (e) => w.pageErrors.push(String(e.message).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (CONSOLE_NOISE.test(t)) return;
    w.consoleErrors.push(t.slice(0, 300));
  });
  page.on("response", async (r) => {
    const url = r.url();
    if (!url.startsWith(SUPABASE_URL)) return;
    const s = r.status();
    if (s < 400) return;
    const path = url.slice(SUPABASE_URL.length).split("?")[0];
    let body = "";
    try { body = (await r.text()).slice(0, 200).replace(/\s+/g, " "); } catch { /* тіло могло вже піти */ }
    const line = `${r.request().method()} ${path} → ${s} ${body}`;
    // 400 (нема колонки/поганий запит), 404 (нема RPC/функції), 5xx — це збої.
    // 401/403 — RLS чи прострочений токен, 406/409 — очікувані відповіді PostgREST.
    if (s === 400 || s === 404 || s >= 500) w.badResponses.push(line);
    else w.softResponses.push(line);
  });
  return w;
}

async function login(page: Page, p: Persona) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  const signin = page.getByRole("tab", { name: /вхід|sign in|logga in/i });
  if (await signin.isVisible().catch(() => false)) await signin.click();
  await page.locator('input[type="email"]:visible').first().fill(p.email!);
  await page.locator('input[type="password"]:visible').first().fill(p.password!);
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForURL(/\/(dashboard|onboarding|student-dashboard)/, { timeout: 45_000 });
}

async function settle(page: Page) {
  // Дати запитам відпрацювати: networkidle на проді з realtime не настає, тому — пауза + текст.
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
  await expect.poll(async () => (await page.locator("body").innerText()).trim().length, { timeout: 20_000 }).toBeGreaterThan(80);
}

function report(w: Watch, where: string) {
  const info = test.info();
  for (const c of w.consoleErrors) info.annotations.push({ type: "console", description: `${where}: ${c}` });
  for (const s of w.softResponses) info.annotations.push({ type: "soft-http", description: `${where}: ${s}` });
  expect(w.pageErrors, `${where}: необроблені помилки JS`).toEqual([]);
  expect(w.badResponses, `${where}: збійні відповіді бази/edge (400 = нема колонки, 404 = нема функції, 5xx)`).toEqual([]);
}

test("лендінг живий: один потік, без помилок", async ({ page }) => {
  const w = watch(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await settle(page);
  for (const t of ERROR_TEXTS) await expect(page.getByText(t, { exact: false }).first(), `на лендінгу видно «${t}»`).toHaveCount(0);
  // Герой = один потік з полем для списку і однією кнопкою (рішення 12.09)
  await expect(page.locator("textarea").first()).toBeVisible();
  report(w, "лендінг");
});

test("збірка на проді = main", async ({ request }) => {
  const r = await request.get("/version.json", { headers: { "cache-control": "no-cache" } });
  const info = test.info();
  // Стара збірка без файла: хостинг SPA віддає index.html (200, але не JSON).
  let stamp: string | undefined; let sha: string | undefined;
  try { ({ stamp, sha } = r.ok() ? ((await r.json()) as { stamp?: string; sha?: string }) : {}); } catch { stamp = undefined; }
  if (!stamp) {
    info.annotations.push({ type: "freshness", description: "прод ще без /version.json — збірка старіша за 22.09 або не опублікована" });
    if (FRESH === "require") throw new Error("Прод не несе /version.json: збірка старіша за пакет 22.09 — потрібен Publish");
    return;
  }
  info.annotations.push({ type: "freshness", description: `прод: ${stamp} (коміт ${sha ?? "?"}) · main: ${EXPECT_STAMP || "?"} (коміт ${EXPECT_SHA || "?"})` });
  if (!EXPECT_STAMP) return;
  // Збіг штампа джерел АБО коміту — прод свіжий (Lovable може збирати з git або без).
  const fresh = stamp === EXPECT_STAMP || (!!EXPECT_SHA && sha === EXPECT_SHA);
  if (!fresh) {
    const msg = `Прод несе збірку ${stamp} (коміт ${sha ?? "?"}), а main — ${EXPECT_STAMP} (коміт ${EXPECT_SHA || "?"}). Ліки: Publish у Lovable.`;
    if (FRESH === "require") throw new Error(msg);
    info.annotations.push({ type: "stale", description: msg });
  }
});

test("edge-функції на проді = репо", async ({ request }) => {
  const info = test.info();
  const r = await request.get(`${SUPABASE_URL}/functions/v1/version`, { failOnStatusCode: false });
  if (r.status() === 404) {
    const msg = "функція `version` ще не задеплоєна — потрібен передеплой усіх edge-функцій";
    info.annotations.push({ type: "freshness", description: msg });
    if (FRESH === "require") throw new Error(msg);
    return;
  }
  let edge: string | undefined; let functions: number | undefined;
  try { ({ edge, functions } = (await r.json()) as { edge?: string; functions?: number }); } catch { edge = undefined; }
  if (!r.ok() || !edge) {
    const msg = `функція version відповіла ${r.status()} без версії — edge-канал перевірити не вдалося`;
    info.annotations.push({ type: "freshness", description: msg });
    if (FRESH === "require") throw new Error(msg);
    return;
  }
  info.annotations.push({ type: "freshness", description: `edge на проді: ${edge} (${functions} функцій) · у репо: ${EDGE_VERSION}` });
  if (edge !== EDGE_VERSION) {
    const msg = `Edge-функції на проді (${edge}) ≠ репо (${EDGE_VERSION}). Ліки: у чаті Lovable — «Передеплой усі edge-функції з репозиторію».`;
    if (FRESH === "require") throw new Error(msg);
    info.annotations.push({ type: "stale", description: msg });
  }
});

for (const p of PERSONAS) {
  test(`${p.label}: логін і головні екрани без збоїв`, async ({ page }) => {
    test.skip(!p.email || !p.password, `TEST_* для «${p.label}» не задано — пропуск`);
    const w = watch(page);
    await login(page, p);
    for (const route of p.routes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await settle(page);
      for (const t of ERROR_TEXTS) {
        await expect(page.getByText(t, { exact: false }).first(), `${p.label} ${route}: видно «${t}»`).toHaveCount(0);
      }
      // Захищений маршрут не має викидати на /auth (протухла сесія = «зникли уроки», 15.09)
      expect(page.url(), `${p.label}: ${route} викинув на інший маршрут`).not.toMatch(/\/auth(\?|$)/);
    }
    report(w, p.label);
  });
}
