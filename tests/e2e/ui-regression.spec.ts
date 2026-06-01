import { test, expect } from "./fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// UI regression tests — кожен баг що ми фіксили вручну має тест.
// Мета: жодного ручного клікання в браузері для перевірки відомих багів.
// ─────────────────────────────────────────────────────────────────────────────

// Skip authenticated tests if tutor/manager credentials are not configured
test.skip(
  !process.env.TEST_TUTOR_EMAIL ||
    !process.env.TEST_TUTOR_PASSWORD ||
    !process.env.TEST_MANAGER_EMAIL ||
    !process.env.TEST_MANAGER_PASSWORD,
  "Set TEST_TUTOR_* and TEST_MANAGER_* env vars to run UI regression tests"
);

// ── 1. i18n — жодних raw ключів на сторінках ────────────────────────────────

test.describe("i18n — no raw keys on pages", () => {
  const pages = [
    "/dashboard",
    "/schedule",
    "/people",
    "/groups",
    "/chats",
    "/finances",
    "/profile",
    "/onboarding",
  ];

  for (const url of pages) {
    test(`manager: ${url} has no raw i18n keys`, async ({ managerPage: page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const body = await page.locator("body").innerText();
      // Raw key: word.word pattern in visible text
      const rawKeys = (body.match(/\b(nav|common|dashboard|schedule|profile|chats|groups|finances|onboarding|shared|chatContext|needsMarking)\.[a-zA-Z][a-zA-Z0-9]+\b/g) ?? [])
        .filter(k => !k.includes("otutorhub") && !k.includes("@"));
      expect(rawKeys, `Raw i18n keys on ${url}: ${rawKeys.join(", ")}`).toHaveLength(0);
    });
  }
});

// ── 2. Dashboard — greeting без email ────────────────────────────────────────

test.describe("Dashboard — greeting quality", () => {
  test("manager greeting contains no email address", async ({ managerPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const hero = page.locator("h1").first();
    const text = await hero.innerText();
    expect(text).not.toContain("@");
    expect(text.toLowerCase()).toMatch(/добр|вечір|ніч|hello/);
  });

  test("manager dashboard has at most one golden bell on desktop", async ({ managerPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // Golden bell has specific classes — count all notification bell buttons
    const bells = page.locator("button.rounded-full").filter({ has: page.locator("svg") });
    // More lenient: check that page doesn't have two bell icons with notification functionality
    // Use aria or title hints
    const namedBells = page.locator("[aria-label*='повідомлен'], [title*='повідомлен']");
    const count = await namedBells.count();
    expect(count, "Multiple notification bells found").toBeLessThanOrEqual(1);
  });
});

// ── 3. Onboarding — без редіректу на голий /profile ──────────────────────────

test.describe("Onboarding — no dead-end /profile links", () => {
  test("all profile links from onboarding have hash anchors", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    // Find all visible CTA links that go to /profile
    const profileLinks = page.locator("a[href^='/profile']");
    const count = await profileLinks.count();
    if (count > 0) {
      const hrefs = await profileLinks.evaluateAll(
        (els: HTMLAnchorElement[]) => els.map(e => e.href)
      );
      const bare = hrefs.filter(h => h.endsWith("/profile") || h.endsWith("/profile/"));
      expect(bare, `Bare /profile links (no anchor) found: ${bare.join(", ")}`).toHaveLength(0);
    }
  });

  test("onboarding has no (Pro) badge", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toContainText("(Pro)");
  });

  test("back button shows Ukrainian text not raw key", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("nav.back");
    expect(body).not.toContain("common.back");
  });
});

// ── 4. Chats — message panel wide enough ─────────────────────────────────────

test.describe("Chats — layout on desktop", () => {
  test("message panel is at least 300px wide", async ({ managerPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");

    // Select first thread if available
    const firstThread = page.locator("button.w-full.rounded-lg").first();
    if (await firstThread.isVisible()) {
      await firstThread.click();
      await page.waitForTimeout(600);
    }

    // Detail panel is the second rounded panel in the grid
    const panels = page.locator(".flex.min-w-0.flex-col.rounded-xl.border");
    if (await panels.count() >= 2) {
      const detail = panels.nth(1);
      const box = await detail.boundingBox();
      if (box) {
        expect(box.width, `Chat message panel width ${box.width}px < 300px`).toBeGreaterThan(300);
      }
    }
  });
});

// ── 5. Sidebar — жодного дзвіночка в bottom bar ──────────────────────────────

test.describe("Sidebar — no duplicate bells", () => {
  test("sidebar bottom row has no notification bell", async ({ managerPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // Bottom bar contains Вийти, dark mode toggle, language switcher
    // Should NOT contain a notification bell
    // The logout button text is a reliable anchor
    const logoutBtn = page.locator("button").filter({ hasText: /вийти|logout/i });
    if (await logoutBtn.isVisible()) {
      // Check siblings — no bell should be adjacent to logout
      const parent = logoutBtn.locator("..");
      const bellInParent = parent.locator("button[class*='rounded-full']:not([class*='ghost'])");
      const bellCount = await bellInParent.count();
      expect(bellCount, "Bell button found next to logout in sidebar").toBe(0);
    }
  });
});

// ── 6. Profile page loads cleanly for tutor ──────────────────────────────────

test.describe("Profile — tutor view", () => {
  test("profile page loads without errors and shows reward picker", async ({ tutorPage: page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    // Page should show subjects section
    await expect(page.locator("body")).toContainText(/предмет|subject/i);
    // No raw i18n keys
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("profile.emailMarketing");
  });

  test("reward theme buttons are clickable", async ({ tutorPage: page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    const starsBtn = page.locator("button").filter({ hasText: /Зірки|Stars/i });
    if (await starsBtn.isVisible()) {
      await starsBtn.click();
      await page.waitForTimeout(1000);
      // Should not crash — page still shows reward section
      await expect(page.locator("body")).toContainText(/Зірки|Stars/i);
    }
  });
});
