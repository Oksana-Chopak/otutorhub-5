import { test, expect } from "@playwright/test";

/**
 * РОБОТ-СМОУКЕР: клацає застосунок замість власниці після кожного пушу.
 * Ціль: не глибина, а «чи не димить» — логін, дашборд, борги+самозвірка,
 * канонічна форма створення уроку, нуль помилок консолі.
 */
const BASE = process.env.SMOKE_BASE_URL
  ?? "https://id-preview--0aa51a41-1c1e-499c-b511-ba5e0d425456.lovable.app";

test("смоук (демо-роль): логін → дашборд → фінанси → форма уроку, консоль чиста", async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const txt = m.text();
    if (/chrome-extension|moz-extension|MetaMask|net::ERR_BLOCKED_BY_CLIENT/i.test(txt)) return;
    consoleErrors.push(txt);
  });

  // ЕТАП 1: логін. На /auth ДВІ форми (вхід/реєстрація у табах) —
  // беремо лише ВИДИМІ поля, інакше заповнюється прихована форма.
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]:visible').first().fill(process.env.E2E_EMAIL!);
  await page.locator('input[type="password"]:visible').first().fill(process.env.E2E_PASSWORD!);
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 45000 });

  // Фінанси: картка боргів + рядок самозвірки (наш канон живий)
  await page.goto(`${BASE}/finances`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText(/Заборгованост|звірені з базою|Розбіжність/i).first()
  ).toBeVisible({ timeout: 30000 });

  // Канонічна форма створення уроку: єдине поле дати-часу на місці
  await page.goto(`${BASE}/schedule?create=1`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[type="datetime-local"]').first())
    .toBeVisible({ timeout: 30000 });

  expect(consoleErrors, `Помилки консолі:\n${consoleErrors.join("\n")}`).toEqual([]);
});
