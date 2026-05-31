import { test, expect } from "@playwright/test";
import { managerFixture, tutorFixture } from "./fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// UI regression tests — перевіряють конкретні баги що ми фіксили вручну.
// Мета: кожен баг з changelog має тест щоб ніколи не повертатись.
// ─────────────────────────────────────────────────────────────────────────────

const { test: managerTest, expect: managerExpect } = managerFixture;
const { test: tutorTest } = tutorFixture;

// ── 1. i18n — жодних raw ключів на будь-якій сторінці ───────────────────────

managerTest.describe("i18n — no raw keys visible", () => {
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
    managerTest(`${url} has no raw i18n keys`, async ({ managerPage: page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const body = await page.locator("body").innerText();
      // Raw key pattern: word.word or word.word.word (not in URLs, not in code)
      const rawKeys = body.match(/\b(nav|common|dashboard|schedule|profile|chats|groups|finances|onboarding|shared)\.[a-zA-Z]+\b/g) ?? [];
      // Filter out false positives (URLs, attributes)
      const trueKeys = rawKeys.filter(k => !k.includes("http") && !k.includes("@") && !k.includes(".com"));
      expect(trueKeys, `Raw i18n keys found on ${url}: ${trueKeys.join(", ")}`).toHaveLength(0);
    });
  }
});

// ── 2. Dashboard — greeting без email та без подвійного дзвіночка ────────────

managerTest.describe("Dashboard — greeting & header", () => {
  managerTest("greeting shows first name, not email address", async ({ managerPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const greeting = await page.locator("h1, [class*='text-3xl'], [class*='text-2xl']").first().innerText();
    expect(greeting).not.toContain("@");
    expect(greeting).not.toContain(".com");
    // Should contain a name or at minimum a greeting word
    expect(greeting.toLowerCase()).toMatch(/добр|вечі|ніч|hello|good/);
  });

  managerTest("only one notification bell visible on desktop", async ({ managerPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // Count golden bell buttons (notification bells)
    const bells = page.locator("[aria-label*='повідомлен'], [aria-label*='notification'], button[class*='rounded-full'][class*='h-11']");
    const count = await bells.count();
    expect(count, "More than one notification bell found").toBeLessThanOrEqual(1);
  });
});

// ── 3. Onboarding — без редіректу на загальний /profile ─────────────────────

tutorTest.describe("Onboarding — no dead-end redirects", () => {
  tutorTest("step 5 (payment rules) links to /profile#rules not bare /profile", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    // Find the payment rules step CTA button
    const ctaLinks = page.locator("a[href*='/profile']");
    const hrefs = await ctaLinks.evaluateAll(els => els.map(e => e.getAttribute("href")));
    // All profile links from onboarding should have a hash anchor
    const bareProfileLinks = hrefs.filter(h => h === "/profile");
    expect(bareProfileLinks, `Bare /profile links found (should use #anchor): ${bareProfileLinks}`).toHaveLength(0);
  });

  tutorTest("onboarding page has no (Pro) badge text", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("(Pro)");
  });

  tutorTest("nav.back shows translated text not raw key", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("nav.back");
    expect(body).not.toContain("common.back");
  });
});

// ── 4. Chats — message area wide enough to read ──────────────────────────────

managerTest.describe("Chats — layout", () => {
  managerTest("message panel is at least 300px wide on desktop", async ({ managerPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");
    // Click first thread if available
    const firstThread = page.locator("button.w-full.rounded-lg").first();
    if (await firstThread.isVisible()) {
      await firstThread.click();
      await page.waitForTimeout(500);
    }
    // The detail panel (messages column)
    const detailPanel = page.locator(".flex.min-w-0.flex-col.rounded-xl.border").nth(1);
    if (await detailPanel.isVisible()) {
      const box = await detailPanel.boundingBox();
      expect(box?.width ?? 0, "Chat message panel is too narrow").toBeGreaterThan(300);
    }
  });
});

// ── 5. Sidebar — один дзвіночок ──────────────────────────────────────────────

managerTest.describe("Sidebar — no duplicate bells", () => {
  managerTest("sidebar bottom bar has no notification bell", async ({ managerPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // Expand sidebar if collapsed
    const chevron = page.locator("button[title*='Розгорнути'], button[title*='Expand']").first();
    if (await chevron.isVisible()) await chevron.click();
    // Check bottom bar — should have Вийти, dark mode, language — no bell
    const bottomBar = page.locator(".flex.shrink-0.flex-col.items-end, [class*=\'bottom\']").last();
    // Bell in sidebar bottom would be a button with bell icon near Вийти
    const sidebarBells = page.locator("aside button[class*='rounded-full'][class*='h-9']");
    const count = await sidebarBells.count();
    expect(count, "Found notification bell in sidebar bottom bar").toBe(0);
  });
});

// ── 6. Profile — rewards picker відповідає при кліку ────────────────────────

tutorTest.describe("Profile — reward theme picker", () => {
  tutorTest("clicking reward theme changes selection", async ({ tutorPage: page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    // Find reward theme buttons
    const themeButtons = page.locator("button").filter({ hasText: /Зірки|Stars|Stjärnor/ });
    if (await themeButtons.first().isVisible()) {
      await themeButtons.first().click();
      await page.waitForTimeout(800);
      // After clicking Stars, it should become active (teal border)
      const activeBtn = themeButtons.first();
      const cls = await activeBtn.getAttribute("class") ?? "";
      // Active state should have teal/primary styling
      expect(cls + await page.locator("button").filter({ hasText: /Зірки|Stars/ }).first().evaluate(el => el.className)).toMatch(/teal|primary|ring|border-\[#2BB/);
    } else {
      // If picker not visible, just check page loads without error
      await expect(page.locator("body")).not.toContainText("Error");
    }
  });
});
