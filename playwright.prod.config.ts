import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Конфіг РОБОТА-СТОРОЖА: клацає ЖИВИЙ прод (не стенд) після кожного пушу і
// щоранку. Окремий від playwright.config.ts (матриця e2e), щоб один зламаний
// старий тест не робив червоним сигнал «прод живий». Облікові дані — ті самі
// TEST_*_EMAIL/PASSWORD з .env.e2e (локально) або секретів GitHub (CI).
const envPath = path.resolve(process.cwd(), ".env.e2e");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export default defineConfig({
  testDir: "./tests/prod",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 26.09: одна персона за раз. Ліміт запитів Supabase рахується НА IP, а робот
  // із двох потоків сам створював 429 — і потім звітував про них як про поломку
  // екранів. Ранкова перевірка не поспішає; довіра до неї коштує дорожче хвилини.
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "prod-report.json" }], ["html", { open: "never", outputFolder: "prod-report" }]],
  use: {
    baseURL: process.env.PROD_BASE_URL ?? "https://otutorhub.com",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
    ...devices["Pixel 7"],
    // Сесія агента може мати Chromium не тієї версії, що Playwright у lock-файлі:
    // тоді PW_CHROMIUM_PATH=/opt/pw-browsers/chromium вказує на наявний бінарник.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: "prod-mobile" }],
});
