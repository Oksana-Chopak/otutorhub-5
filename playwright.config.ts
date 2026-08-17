import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Load .env.e2e (git-ignored) so TEST_*_EMAIL/PASSWORD + E2E_BASE_URL are
// available without an extra dependency. An already-set process.env wins.
const envPath = path.resolve(process.cwd(), ".env.e2e");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",

  timeout: 30_000,
  expect: { timeout: 10_000 },

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,

  reporter: process.env.CI ? [["github"], ["line"]] : "list",
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "on-failure" }]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://otutorhub.com",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
