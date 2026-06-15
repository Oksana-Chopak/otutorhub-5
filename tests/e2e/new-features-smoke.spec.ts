import { test, expect, loginAs, TEST_TUTOR, TEST_HUB_TUTOR, TEST_STUDENT } from "./fixtures";

/**
 * Read-only smoke for the two new features on the release-audit branch:
 *  - student achievements page (/student/achievements, student-only)
 *  - "Менеджер хабу" chat button (hub-tutor dashboard)
 * Run against a LOCAL dev server (the features aren't on prod yet):
 *   E2E_BASE_URL=http://localhost:8080 npx playwright test new-features-smoke --project=chromium
 * Navigation + assertions only — never creates/edits data.
 */

test.describe("New features — smoke", () => {
  test("student → /student/achievements renders", async ({ browser }) => {
    test.skip(!TEST_STUDENT.email || !TEST_STUDENT.password, "TEST_STUDENT_* not set");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, TEST_STUDENT);
    await page.goto("/student/achievements");
    await page.waitForLoadState("networkidle");
    console.log("[student-achievements] landed on:", page.url());
    // If the account isn't a student, ProtectedRoute redirects away from this path.
    expect(page.url(), "should stay on /student/achievements (account must be a student)").toContain("/student/achievements");
    await expect(
      page.getByRole("heading", { name: /досягнення|achievements|prestationer/i }),
    ).toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test("hub tutor → dashboard shows «Менеджер хабу»", async ({ browser }) => {
    test.skip(!TEST_HUB_TUTOR.email || !TEST_HUB_TUTOR.password, "TEST_HUB_TUTOR_* not set");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, TEST_HUB_TUTOR);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    console.log("[hub-manager] landed on:", page.url());
    await expect(
      page.getByRole("button", { name: /менеджер хабу|hub manager|hubbansvarig/i }),
    ).toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test("tutor → dashboard loads (no auth redirect)", async ({ browser }) => {
    test.skip(!TEST_TUTOR.email || !TEST_TUTOR.password, "TEST_TUTOR_* not set");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, TEST_TUTOR);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    console.log("[tutor-dashboard] landed on:", page.url());
    expect(page.url(), "should not be on /auth after login").not.toContain("/auth");
    await ctx.close();
  });
});
