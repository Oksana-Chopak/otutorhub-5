import { test, expect, assertNoRawKeys, watchConsoleErrors } from "./fixtures";

// ── Tutor Flow E2E Tests ────────────────────────────────────────────────────
// Tests the complete journey of an independent tutor on otutorhub.com

test.describe("Tutor — Dashboard", () => {
  test("loads without errors and shows correct content", async ({ tutorPage: page }) => {
    const errors = watchConsoleErrors(page);

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // No raw i18n keys
    await assertNoRawKeys(page);

    // No JS errors
    expect(errors.filter(e => !e.includes("ResizeObserver"))).toHaveLength(0);

    // Key elements present
    await expect(page.getByText(/доброго|добрий|привіт/i)).toBeVisible();
    
    // Lesson count shows correctly (not "00" or "11")
    const lessonCount = page.locator("text=/\\d+ урок/i").first();
    if (await lessonCount.isVisible()) {
      const text = await lessonCount.textContent();
      // Should not have doubled digits like "00" or "11"
      expect(text).not.toMatch(/(\d)\1/);
    }
  });

  test("Quick Actions button opens panel", async ({ tutorPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const quickActionsBtn = page.getByRole("button", { name: /швидк|quick|дія/i }).first();
    if (await quickActionsBtn.isVisible()) {
      await quickActionsBtn.click();
      // Panel should open
      await expect(page.getByText(/учень|урок|оплата/i).first()).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe("Tutor — My Students", () => {
  test("page loads and shows student list", async ({ tutorPage: page }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Page title visible
    await expect(page.getByText(/мої учні/i)).toBeVisible();

    // Add student button visible
    await expect(
      page.getByRole("button", { name: /додати учня/i })
    ).toBeVisible();
  });

  test("Add student dialog opens with progressive disclosure", async ({ tutorPage: page }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /додати учня/i }).click();

    // Dialog opens
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Core fields visible
    await expect(dialog.getByLabel(/ім.я/i)).toBeVisible();
    await expect(dialog.getByText(/предмет/i)).toBeVisible();
    await expect(dialog.getByText(/ціна/i)).toBeVisible();

    // Phone/email NOT visible initially (progressive disclosure)
    await expect(dialog.getByLabel(/телефон|phone/i)).not.toBeVisible();
    await expect(dialog.getByLabel(/email/i)).not.toBeVisible();

    // Toggle shows extra fields
    const toggle = dialog.getByText(/додати контакти|add contacts/i);
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Now phone is visible
    await expect(dialog.getByLabel(/телефон|phone/i)).toBeVisible();
  });

  test("student count uses correct plural form", async ({ tutorPage: page }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");

    // Should NOT show "1 учнів" (wrong plural)
    const countText = await page.locator("text=/\\d+ учн/i").first().textContent().catch(() => null);
    if (countText) {
      // 1 = учень, 2-4 = учні, 5+ = учнів
      const count = parseInt(countText);
      if (count === 1) {
        expect(countText).toMatch(/1 учень/);
      }
    }
  });
});

test.describe("Tutor — Schedule", () => {
  test("page loads with calendar view", async ({ tutorPage: page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Calendar present
    await expect(page.getByText(/розклад|schedule/i).first()).toBeVisible();

    // Create lesson button visible  
    await expect(
      page.getByRole("button", { name: /створити урок|create lesson/i })
    ).toBeVisible();
  });

  test("Create lesson button opens 2-step dialog", async ({ tutorPage: page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /створити урок/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Step 1 indicator
    await expect(dialog.getByText(/1/)).toBeVisible();

    // Has student selector
    await expect(dialog.getByText(/учень|student/i)).toBeVisible();
  });
});

test.describe("Tutor — Finances", () => {
  test("page shows Income and Debts tabs (no Expenses tab)", async ({ tutorPage: page }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    const tabs = page.getByRole("tab");
    const tabTexts = await tabs.allTextContents();

    // Should have Income and Debts
    expect(tabTexts.some(t => /доход|income/i.test(t))).toBe(true);
    expect(tabTexts.some(t => /борг|debt/i.test(t))).toBe(true);

    // Should NOT have Expenses
    expect(tabTexts.some(t => /витрат|expense/i.test(t))).toBe(false);
  });

  test("auto-switches to Debts tab when unpaid lessons exist", async ({ tutorPage: page }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    // Check if any lessons are visible in debts
    const debtRows = await page.locator("text=/очікує|unpaid/i").count();
    if (debtRows > 0) {
      // Should be on Debts tab
      const activeTab = page.getByRole("tab", { selected: true });
      const tabText = await activeTab.textContent();
      expect(tabText).toMatch(/борг|debt/i);
    }
  });
});

test.describe("Tutor — Chats", () => {
  test("page loads without raw i18n keys", async ({ tutorPage: page }) => {
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Chat list visible
    await expect(page.getByText(/чати|chats/i).first()).toBeVisible();
  });

  test("opening a thread with both participants shows context panel", async ({ tutorPage: page }) => {
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");

    // Find a thread that has both tutor and student (indicated by ↔)
    const threads = page.locator("button").filter({ hasText: /↔/ });
    const count = await threads.count();

    if (count > 0) {
      await threads.first().click();
      await page.waitForTimeout(1500);

      // Context panel should appear
      const contextPanel = page.getByText(/контекст|context/i).first();
      await expect(contextPanel).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Tutor — Onboarding", () => {
  test("onboarding page loads all steps", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Progress indicator visible
    await expect(page.locator("[class*='progress'], [class*='step']").first()).toBeVisible();

    // Steps visible
    await expect(page.getByText(/учня|lesson|zoom|telegram/i).first()).toBeVisible();
  });
});
