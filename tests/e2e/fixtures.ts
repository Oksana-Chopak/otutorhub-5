import { test as base, expect, Page } from "@playwright/test";

// ── Test credentials (from environment variables) ──────────────────────────
export const TEST_TUTOR = {
  email: process.env.TEST_TUTOR_EMAIL ?? "",
  password: process.env.TEST_TUTOR_PASSWORD ?? "",
};

export const TEST_MANAGER = {
  email: process.env.TEST_MANAGER_EMAIL ?? "",
  password: process.env.TEST_MANAGER_PASSWORD ?? "",
};

export const TEST_STUDENT = {
  email: process.env.TEST_STUDENT_EMAIL ?? "",
  password: process.env.TEST_STUDENT_PASSWORD ?? "",
};

// ── Custom fixtures ────────────────────────────────────────────────────────
type Fixtures = {
  tutorPage: Page;
  managerPage: Page;
};

export const test = base.extend<Fixtures>({
  tutorPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, TEST_TUTOR);
    await use(page);
    await context.close();
  },

  managerPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, TEST_MANAGER);
    await use(page);
    await context.close();
  },
});

export { expect };

// ── Login helper ────────────────────────────────────────────────────────────
export async function loginAs(
  page: Page,
  credentials: { email: string; password: string }
) {
  await page.goto("/auth");
  await page.waitForLoadState("networkidle");

  // Click Sign In tab
  const signinTab = page.getByRole("tab").filter({ hasText: /вхід|sign in/i });
  if (await signinTab.isVisible()) {
    await signinTab.click();
  }

  await page.getByLabel(/email/i).fill(credentials.email);
  await page.getByLabel(/пароль|password/i).fill(credentials.password);
  await page.getByRole("button", { name: /увійти|sign in|login/i }).click();

  // Wait for dashboard to load
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

// ── Wait for no raw i18n keys ───────────────────────────────────────────────
export async function assertNoRawKeys(page: Page) {
  const text = await page.locator("body").innerText();
  // Raw keys look like "nav.schedule" or "CHATS.MANAGERBADGE"
  const rawKeyPattern = /\b[a-z]{2,}\.[a-zA-Z]{3,}[A-Z][a-zA-Z]+\b|\b[A-Z]{3,}\.[A-Z]{3,}\b/g;
  const matches = text.match(rawKeyPattern) ?? [];
  // Filter out known false positives
  const realIssues = matches.filter(
    (k) =>
      !k.includes("otutorhub") &&
      !k.includes("google") &&
      !k.includes("zoom.us") &&
      !k.includes("meet.google")
  );

  expect(
    realIssues,
    `Raw i18n keys found on page: ${realIssues.join(", ")}`
  ).toHaveLength(0);
}

// ── Assert no console errors ────────────────────────────────────────────────
export function watchConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}
