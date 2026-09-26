import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// Функції з verify_jwt = true у supabase/config.toml: шлюз Supabase відкидає запит без
// JWT ще ДО нашого коду (401), тож проба `?version` без ключа не каже нічого про
// версію. 23.09 робот назвав так `remind-payment` «застарілою» — хибна тривога.
// Для них проба йде з публічним anon-ключем (він і є валідний JWT ролі anon).
const JWT_PROTECTED: Set<string> = (() => {
  const out = new Set<string>();
  try {
    const toml = readFileSync(fileURLToPath(new URL("../../supabase/config.toml", import.meta.url)), "utf8");
    for (const block of toml.split(/\n\s*\[functions\./).slice(1)) {
      const name = block.match(/^([a-z0-9_-]+)\]/)?.[1];
      if (name && /verify_jwt\s*=\s*true/.test(block.split(/\n\s*\[/)[0])) out.add(name);
    }
  } catch { /* без config.toml — усі функції вважаються відкритими */ }
  return out;
})();

// Публічний anon-ключ проду: з секрету CI або з самої збірки на сайті (він там є
// за визначенням — його бачить кожен браузер). Без нього захищені функції просто
// позначаються «не перевірити», а не «застарілі».
async function findAnonKey(request: APIRequestContext): Promise<string | null> {
  if (process.env.PROD_SUPABASE_ANON_KEY) return process.env.PROD_SUPABASE_ANON_KEY;
  const isAnonJwt = (tok: string) => {
    try { return JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString("utf8")).role === "anon"; } catch { return false; }
  };
  try {
    const html = await (await request.get("/", { headers: { "cache-control": "no-cache" } })).text();
    const urls = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]).slice(0, 12);
    for (const u of urls) {
      const js = await (await request.get(u)).text().catch(() => "");
      for (const m of js.matchAll(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g)) if (isAnonJwt(m[0])) return m[0];
    }
  } catch { /* сайт не віддав збірку — нижче це стане чесним «не перевірити» */ }
  return null;
}
const CONSOLE_NOISE = /chrome-extension|moz-extension|ERR_BLOCKED_BY_CLIENT|clarity\.ms|facebook|fbevents|favicon|ResizeObserver|Third-party cookie|Permissions policy|was preloaded|net::ERR_|Failed to load resource|\[vite\]|service worker|ServiceWorker|sw\.js/i;

type Persona = { key: string; label: string; email?: string; password?: string; routes: string[] };
const PERSONAS: Persona[] = [
  { key: "ind", label: "самостійний репетитор", email: process.env.TEST_TUTOR_EMAIL, password: process.env.TEST_TUTOR_PASSWORD, routes: ["/dashboard", "/schedule", "/my-students", "/finances", "/profile"] },
  { key: "manager", label: "менеджер школи", email: process.env.TEST_MANAGER_EMAIL, password: process.env.TEST_MANAGER_PASSWORD, routes: ["/dashboard", "/people", "/schedule", "/finances", "/groups"] },
  { key: "hub", label: "хабовий репетитор", email: process.env.TEST_HUB_TUTOR_EMAIL, password: process.env.TEST_HUB_TUTOR_PASSWORD, routes: ["/dashboard", "/schedule", "/finances", "/profile"] },
  { key: "student", label: "учень", email: process.env.TEST_STUDENT_EMAIL, password: process.env.TEST_STUDENT_PASSWORD, routes: ["/student-dashboard", "/student/schedule", "/student/payments", "/student/homework"] },
];

type Watch = { pageErrors: string[]; consoleErrors: string[]; badResponses: string[]; softResponses: string[]; rateLimited: string[]; authStatuses: number[] };
function watch(page: Page): Watch {
  const w: Watch = { pageErrors: [], consoleErrors: [], badResponses: [], softResponses: [], rateLimited: [], authStatuses: [] };
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
    const path = url.slice(SUPABASE_URL.length).split("?")[0];
    // 26.09: відповідь самого ВХОДУ — окремо. Без неї «не дійшли до дашборда»
    // і «прод відмовив у вході» виглядають однаково (тайм-аут).
    if (path.startsWith("/auth/v1/token")) w.authStatuses.push(s);
    if (s < 400) return;
    let body = "";
    try { body = (await r.text()).slice(0, 200).replace(/\s+/g, " "); } catch { /* тіло могло вже піти */ }
    const line = `${r.request().method()} ${path} → ${s} ${body}`;
    // 26.09: 429 «забагато запитів» — окремий клас. Ліміт Supabase рахується НА IP
    // (мобільний оператор і шкільний Wi-Fi ховають за однією адресою сотні людей;
    // скан логів 16.09 — «permission denied рівно тоді, коли оновлення токена
    // впирається в ліміт»). Це тимчасова відмова, а не зламаний екран: застосунок
    // повторює читання сам (fetchWithTimeout), а робот стукає частіше за людину.
    if (s === 429) w.rateLimited.push(line);
    // 400 (нема колонки/поганий запит), 404 (нема RPC/функції), 5xx — це збої.
    // 401/403 — RLS чи прострочений токен, 406/409 — очікувані відповіді PostgREST.
    if (s === 400 || s === 404 || s >= 500) w.badResponses.push(line);
    else w.softResponses.push(line);
  });
  return w;
}

// Що саме бачив робот у момент збою — щоб повідомлення в Telegram і звіт CI казали
// причину, а не лише «видно «Не вдалося завантажити»» (перший звіт 23.09 саме так і
// лишив агента без діагностики: журнал GitHub закритий, а деталі жили лише в ньому).
async function diagnose(page: Page, w: Watch): Promise<string> {
  const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
  const toasts = (await page.locator('[data-sonner-toast], [role="alert"], [role="status"]').allInnerTexts().catch(() => []))
    .map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  const lines = [`адреса: ${page.url()}`];
  if (w.rateLimited.length) lines.push(`⚠️ прод обмежував частоту: 429 ×${w.rateLimited.length} — тимчасова відмова на IP, не поломка екрана`);
  if (w.authStatuses.length) lines.push(`відповідь входу (/auth/v1/token): ${w.authStatuses.join(", ")}`);
  if (toasts.length) lines.push(`повідомлення на екрані: ${toasts.join(" | ").slice(0, 300)}`);
  lines.push(`екран: «${body}»`);
  for (const l of w.badResponses.slice(-5)) lines.push(`збій бази/edge: ${l}`);
  for (const l of w.softResponses.slice(-5)) lines.push(`http: ${l}`);
  for (const l of w.consoleErrors.slice(-3)) lines.push(`console: ${l}`);
  for (const l of w.pageErrors.slice(-3)) lines.push(`js: ${l}`);
  return lines.join("\n");
}

async function login(page: Page, p: Persona, w: Watch) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  const signin = page.getByRole("tab", { name: /вхід|sign in|logga in/i });
  if (await signin.isVisible().catch(() => false)) await signin.click();
  await page.locator('input[type="email"]:visible').first().fill(p.email!);
  await page.locator('input[type="password"]:visible').first().fill(p.password!);
  await page.locator('button[type="submit"]:visible').first().click();
  try {
    await page.waitForURL(/\/(dashboard|onboarding|student-dashboard)/, { timeout: 45_000 });
  } catch {
    // Не «timeout», а ЩО сталося: лишились на /auth (пароль? помилка входу?),
    // застрягли на «/» без ролі (index.rolePending), чи приземлились деінде.
    const path = new URL(page.url()).pathname;
    // 26.09: спершу дивимось, що відповів САМ вхід. 429 = ліміт на IP (пройде
    // за хвилини), 400 = невірні дані тестового акаунта — це різні ліки, а
    // маршрут у цих двох випадках однаковий.
    const refused = w.authStatuses.filter((s) => s >= 400);
    if (refused.length) {
      throw new Error(
        `${p.label}: прод відмовив у вході — /auth/v1/token відповів ${refused.join(", ")}` +
        (refused.includes(429) ? " (429 = ліміт запитів на IP, тимчасово; продукт не зламаний)" : " (400 = невірні дані тестового акаунта)") +
        `\n${await diagnose(page, w)}`,
      );
    }
    const stuckOnAuth = path.startsWith("/auth");
    const stuckOnRoot = path === "/";
    const why = stuckOnAuth
      ? "лишились на сторінці входу — вхід не пройшов (пароль тестового акаунта? помилка від auth?)"
      : stuckOnRoot
        ? "увійшли, але застрягли на головній — застосунок не бачить ролі акаунта (user_roles порожній для цього користувача?)"
        : "увійшли, але приземлились на несподіваний маршрут";
    throw new Error(`${p.label}: вхід не завершився за 45 с — ${why}\n${await diagnose(page, w)}`);
  }
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

const PROBED_FNS = ["payment-reminders", "send-push", "tutor-daily-digest", "telegram-poll", "remind-payment"];

test("edge-функції на проді = репо", async ({ request }) => {
  const info = test.info();
  // 1) функція `version` — штамп усього пакета; 2) пойменні проби `?version`
  // п'яти функцій (інша сесія, 22.09) — щоб бачити ЧАСТКОВИЙ передеплой поіменно.
  const seen: Record<string, string> = {};
  const unverifiable: string[] = [];
  const anon = await findAnonKey(request);
  const probe = async (name: string, url: string) => {
    const protectedFn = JWT_PROTECTED.has(name);
    if (protectedFn && !anon) { unverifiable.push(name); return; }
    const headers = anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {};
    const r = await request.get(url, { failOnStatusCode: false, headers });
    if (r.status() === 404) { seen[name] = "не задеплоєна"; return; }
    if (r.status() === 401 && protectedFn) { unverifiable.push(name); return; } // шлюз не пустив навіть з ключем
    try {
      const j = (await r.json()) as { edge?: string; build?: string };
      seen[name] = j.edge ?? j.build ?? `?(${r.status()})`;
    } catch { seen[name] = `стара версія (${r.status()})`; }
  };
  await probe("version", `${SUPABASE_URL}/functions/v1/version`);
  for (const fn of PROBED_FNS) await probe(fn, `${SUPABASE_URL}/functions/v1/${fn}?version`);
  const stale = Object.entries(seen).filter(([, v]) => v !== EDGE_VERSION).map(([k, v]) => `${k}: ${v}`);
  info.annotations.push({ type: "freshness", description: `edge у репо: ${EDGE_VERSION} · прод: ${Object.entries(seen).map(([k, v]) => `${k}=${v}`).join(", ")}` });
  if (unverifiable.length) {
    info.annotations.push({ type: "freshness", description: `версію ${unverifiable.join(", ")} ззовні не перевірити: функція захищена JWT, а ключ проду роботові недоступний` });
  }
  if (stale.length) {
    const msg = `Edge-функції на проді застарілі (${stale.join("; ")}) — репо ${EDGE_VERSION}. Ліки: у чаті Lovable — «Передеплой усі edge-функції з репозиторію».`;
    if (FRESH === "require") throw new Error(msg);
    info.annotations.push({ type: "stale", description: msg });
  }
});

for (const p of PERSONAS) {
  test(`${p.label}: логін і головні екрани без збоїв`, async ({ page }) => {
    test.skip(!p.email || !p.password, `TEST_* для «${p.label}» не задано — пропуск`);
    const w = watch(page);
    await login(page, p, w);
    for (const route of p.routes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await settle(page);
      for (const t of ERROR_TEXTS) {
        // Не голий «видно текст», а з діагностикою: який запит упав і що на екрані —
        // інакше причину знає лише закритий журнал GitHub (урок першого звіту 23.09).
        if ((await page.getByText(t, { exact: false }).count()) > 0) {
          throw new Error(`${p.label} ${route}: видно «${t}»\n${await diagnose(page, w)}`);
        }
      }
      // Захищений маршрут не має викидати на /auth (протухла сесія = «зникли уроки», 15.09)
      if (/\/auth(\?|$)/.test(page.url())) {
        throw new Error(`${p.label}: ${route} викинув на сторінку входу\n${await diagnose(page, w)}`);
      }
    }
    report(w, p.label);
  });
}
