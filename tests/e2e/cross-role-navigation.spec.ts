import {
  test,
  expect,
  loginAs,
  watchConsoleErrors,
  TEST_MANAGER,
  TEST_TUTOR,
  TEST_HUB_TUTOR,
  TEST_STUDENT,
} from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Cross-role navigation sanity — READ-ONLY.
 *
 * For EVERY role we visit each page that role can reach and assert it loads sanely:
 *   • stays on the route (not bounced to /auth — the route guard accepts this role),
 *   • no crash (the ErrorBoundary fallback is not shown),
 *   • no uncaught JS exception (pageerror),
 *   • the page rendered real content (not blank),
 *   • no app-level console errors.
 * Then we click every sidebar nav destination and assert each transition lands on the
 * right page without a crash.
 *
 * This is the layer that catches "a page or transition is DEAD for THIS role" — the
 * exact class of bug that previously only surfaced during manual testing (hub tutor
 * especially). It never creates or edits data, and runs automatically in CI
 * (.github/workflows/ci.yml → playwright).
 *
 * Local run (against a dev server with the new code):
 *   E2E_BASE_URL=http://localhost:8080 npx playwright test cross-role-navigation --project=chromium
 */

const ERROR_BOUNDARY = /Щось пішло не так|Something went wrong|Något gick fel/i;

// Console noise that is NOT an app bug (network/auth/3rd-party/devtools/HMR).
const CONSOLE_IGNORE =
  /Failed to load resource|net::ERR|status of (4|5)\d\d|\b40[134]\b|favicon|ResizeObserver|React DevTools|Download the React|\[vite\]|sonner/i;

type Creds = { email: string; password: string };

const ROLES: Record<string, { creds: Creds; start: string; pages: string[] }> = {
  Manager: {
    creds: TEST_MANAGER,
    start: "/dashboard",
    pages: ["/dashboard", "/schedule", "/people", "/finances", "/groups", "/chats", "/profile", "/availability"],
  },
  "Independent tutor": {
    creds: TEST_TUTOR,
    start: "/dashboard",
    pages: ["/dashboard", "/schedule", "/my-students", "/finances", "/chats", "/profile", "/availability", "/achievements"],
  },
  "Hub tutor": {
    creds: TEST_HUB_TUTOR,
    start: "/dashboard",
    // hub-tutor parity surface — the routes the hub tutor newly/also reaches
    pages: ["/dashboard", "/schedule", "/finances", "/chats", "/profile", "/availability", "/achievements", "/groups"],
  },
  Student: {
    creds: TEST_STUDENT,
    start: "/student-dashboard",
    pages: ["/student-dashboard", "/achievements"],
  },
};

async function assertSane(page: Page, route: string, pageErrors: string[]) {
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(page.url(), `${route}: bounced to /auth (lost session or route blocked this role)`).not.toContain("/auth");
  expect(page.url(), `${route}: did not stay on the route (silent redirect)`).toContain(route);
  await expect(page.getByText(ERROR_BOUNDARY), `${route}: ErrorBoundary (crash) is shown`).toHaveCount(0);
  const body = (await page.locator("body").innerText()).trim();
  expect(body.length, `${route}: rendered too little — blank or crashed`).toBeGreaterThan(60);
  expect(pageErrors, `${route}: uncaught JS error(s): ${pageErrors.join(" | ")}`).toEqual([]);
}

for (const [role, cfg] of Object.entries(ROLES)) {
  test(`${role} — every page loads sanely (no crash / console errors)`, async ({ browser }) => {
    test.skip(!cfg.creds.email || !cfg.creds.password, `${role} test creds not set in .env.e2e`);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const consoleErrors = watchConsoleErrors(page);

    await loginAs(page, cfg.creds);
    for (const route of cfg.pages) {
      await page.goto(route);
      await assertSane(page, route, pageErrors);
    }

    const real = consoleErrors.filter((e) => !CONSOLE_IGNORE.test(e));
    expect(real, `${role}: console errors across pages: ${real.join(" | ")}`).toEqual([]);
    await ctx.close();
  });

  test(`${role} — sidebar nav transitions are all alive`, async ({ browser }) => {
    test.skip(!cfg.creds.email || !cfg.creds.password, `${role} test creds not set in .env.e2e`);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await loginAs(page, cfg.creds);
    await page.goto(cfg.start);
    await page.waitForLoadState("networkidle").catch(() => {});

    // Click only the role's known nav destinations that the app actually renders as
    // links — asserting each click lands on the right page without a crash.
    const wanted = new Set(cfg.pages);
    const hrefs = [
      ...new Set(
        (await page.locator('a[href^="/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")))).filter(
          (h): h is string => !!h,
        ),
      ),
    ].filter((h) => wanted.has(h));

    expect(hrefs.length, `${role}: expected the sidebar to render its nav links`).toBeGreaterThan(1);

    for (const href of hrefs) {
      const link = page.locator(`a[href="${href}"]`).first();
      if (!(await link.isVisible().catch(() => false))) continue;
      await link.click().catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByText(ERROR_BOUNDARY), `${role}: crash after clicking → ${href}`).toHaveCount(0);
      expect(page.url(), `${role}: nav → ${href} bounced to /auth`).not.toContain("/auth");
      expect(page.url(), `${role}: nav → ${href} did not land on the page`).toContain(href);
    }

    expect(pageErrors, `${role}: uncaught error during navigation: ${pageErrors.join(" | ")}`).toEqual([]);
    await ctx.close();
  });
}
