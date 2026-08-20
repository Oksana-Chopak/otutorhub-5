import { test, expect, type Page } from "@playwright/test";

/**
 * РОБОТ-СМОУКЕР — клацає прод замість власниці після кожного пушу.
 * Два тести з РІЗНИМИ іменами, щоб червоний колір сам називав причину:
 *  1) «деплой свіжий?» — чи доїхав останній main до прод-збірки;
 *  2) «ядро живе?» — логін, сторінки відкриваються, консоль чиста
 *     (стійко до ПОРОЖНЬОГО демо-акаунта без учнів/даних).
 */
const BASE = process.env.SMOKE_BASE_URL ?? "https://otutorhub.com";

async function login(page: Page) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]:visible').first().fill(process.env.E2E_EMAIL!);
  await page.locator('input[type="password"]:visible').first().fill(process.env.E2E_PASSWORD!);
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 45000 });
}

test("ДЕПЛОЙ СВІЖИЙ: канонічне поле дати-часу присутнє у формі уроку", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E_EMAIL/PASSWORD відсутні — пропуск");
  test.setTimeout(120000);
  await login(page);
  await page.goto(`${BASE}/schedule?create=1`, { waitUntil: "domcontentloaded" });
  // datetime-local зʼявився в коді 03.08 (DateTimeField). Якщо його нема —
  // прод зібраний зі СТАРОГО коду: майстерня Lovable не підтягнула main.
  await expect(
    page.locator('input[type="datetime-local"]').first(),
    "Прод-збірка застаріла: у Lovable-чаті напиши «підтягни останні комміти з GitHub main», потім Publish"
  ).toBeVisible({ timeout: 30000 });
});

test("ЯДРО ЖИВЕ: логін → фінанси → розклад відкриваються, консоль чиста", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL, "E2E_EMAIL/PASSWORD відсутні — пропуск");
  test.setTimeout(120000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/chrome-extension|moz-extension|MetaMask|ERR_BLOCKED_BY_CLIENT/i.test(t)) return;
    consoleErrors.push(t);
  });

  await login(page);

  // Фінанси: сторінка ВІДКРИЛАСЬ (заголовок маршруту) — без вимог до даних,
  // бо демо-акаунт може бути порожнім.
  await page.goto(`${BASE}/finances`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Фінанси").first()).toBeVisible({ timeout: 30000 });

  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Розклад|Календар/).first()).toBeVisible({ timeout: 30000 });

  expect(consoleErrors, `Помилки консолі:\n${consoleErrors.join("\n")}`).toEqual([]);
});

test("МЕНЕДЖЕР: нова форма уроку реально відкривається (без вічного спінера)", async ({ page }) => {
  test.skip(!process.env.TEST_MANAGER_EMAIL, "TEST_MANAGER_* відсутні — пропуск");
  test.setTimeout(120000);
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]:visible').first().fill(process.env.TEST_MANAGER_EMAIL!);
  await page.locator('input[type="password"]:visible').first().fill(process.env.TEST_MANAGER_PASSWORD!);
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 45000 });
  await page.goto(`${BASE}/schedule?create=1`, { waitUntil: "domcontentloaded" });
  // Форма ВІДКРИЛАСЬ = видно вибір репетитора (він над loading-гейтом).
  await expect(
    page.getByText("Оберіть репетитора").first(),
    "Менеджерська форма не відкрилась — ймовірно завис спінер завантаження"
  ).toBeVisible({ timeout: 25000 });
});
