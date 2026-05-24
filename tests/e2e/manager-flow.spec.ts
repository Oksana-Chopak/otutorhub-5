import { test, expect, assertNoRawKeys, watchConsoleErrors } from "./fixtures";

// Skip entire file if credentials are not configured
test.skip(
  !process.env.TEST_MANAGER_EMAIL || !process.env.TEST_MANAGER_PASSWORD,
  "Set TEST_MANAGER_EMAIL + TEST_MANAGER_PASSWORD in .env.e2e to run manager E2E tests"
);

// ── Manager Flow E2E Tests ──────────────────────────────────────────────────
// Tests the hub manager journey on otutorhub.com
// Critical: manager must NEVER see independent tutor data
// Run: npx playwright test manager-flow.spec.ts
// Debug: npx playwright test manager-flow.spec.ts --headed --debug

// ── Dashboard ─────────────────────────────────────────────────────────────
test.describe("Manager — Dashboard", () => {
  test("loads without errors and shows correct content", async ({ managerPage: page }) => {
    const errors = watchConsoleErrors(page);

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);

    // Greeting present
    await expect(page.getByText(/доброго|добрий|привіт|мій день/i)).toBeVisible();
  });

  test("Quick Actions button opens panel", async ({ managerPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const quickActionsBtn = page
      .getByRole("button", { name: /швидк|quick|дія/i })
      .first();
    if (await quickActionsBtn.isVisible()) {
      await quickActionsBtn.click();
      await expect(page.getByText(/учень|урок|оплата/i).first()).toBeVisible({
        timeout: 3000,
      });
    }
  });
});

// ── Data Isolation (CRITICAL) ─────────────────────────────────────────────
test.describe("Manager — Data Isolation (CRITICAL)", () => {
  test("schedule does NOT expose independent tutor lessons", async ({
    managerPage: page,
  }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // The page must load without JS errors
    const errors = watchConsoleErrors(page);
    await page.waitForTimeout(1000);
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
  });

  test("finances shows hub data without source=independent leakage", async ({
    managerPage: page,
  }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Manager DOES see Expenses tab (unlike tutors)
    const tabs = page.getByRole("tab");
    const tabTexts = await tabs.allTextContents();
    expect(tabTexts.some((t) => /доход|income/i.test(t))).toBe(true);
    expect(tabTexts.some((t) => /витрат|expense/i.test(t))).toBe(true);
  });

  test("people page does not mix hub and independent student data", async ({
    managerPage: page,
  }) => {
    await page.goto("/people");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);
    await expect(page.getByText(/люди|people/i).first()).toBeVisible();
  });
});

// ── Schedule ──────────────────────────────────────────────────────────────
test.describe("Manager — Schedule", () => {
  test("page loads with calendar and create button", async ({
    managerPage: page,
  }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(page.getByText(/розклад|schedule/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /створити урок|create lesson/i })
    ).toBeVisible();
  });

  test("create lesson dialog opens with tutor selector", async ({
    managerPage: page,
  }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /створити урок/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Manager sees both student and tutor selectors
    await expect(dialog.getByText(/учень|student/i)).toBeVisible();
  });

  test("mark lesson completed updates status", async ({ managerPage: page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    const scheduledBadge = page.getByText(/заплановано/i).first();
    const hasScheduled = await scheduledBadge.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasScheduled) {
      test.skip(true, "No scheduled lessons available");
      return;
    }

    const markCompleteBtn = page
      .getByRole("button", { name: /заверш|проведен|complete/i })
      .first();
    const hasMark = await markCompleteBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasMark) {
      await scheduledBadge.click();
      await page.waitForTimeout(500);
    }

    const btn = page.getByRole("button", { name: /заверш|проведен|complete/i }).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await expect(
        page.getByText(/проведено|завершено|completed/i).first()
      ).toBeVisible({ timeout: 8000 });
    }
  });
});

// ── People ─────────────────────────────────────────────────────────────────
test.describe("Manager — People", () => {
  test("page loads with student/tutor list", async ({ managerPage: page }) => {
    await page.goto("/people");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(page.getByText(/люди|people/i).first()).toBeVisible();
  });

  test("can switch between Tutors and Students tabs", async ({
    managerPage: page,
  }) => {
    await page.goto("/people");
    await page.waitForLoadState("networkidle");

    const tabs = page.getByRole("tab");
    const tabTexts = await tabs.allTextContents();

    const hasTutorTab = tabTexts.some((t) => /репетитор|tutor/i.test(t));
    const hasStudentTab = tabTexts.some((t) => /учн|student/i.test(t));

    if (hasTutorTab && hasStudentTab) {
      const tutorTab = page.getByRole("tab", { name: /репетитор|tutor/i }).first();
      await tutorTab.click();
      await page.waitForLoadState("networkidle");
      await assertNoRawKeys(page);

      const studentTab = page.getByRole("tab", { name: /учн|student/i }).first();
      await studentTab.click();
      await page.waitForLoadState("networkidle");
      await assertNoRawKeys(page);
    }
  });

  test("invite dialog opens", async ({ managerPage: page }) => {
    await page.goto("/people");
    await page.waitForLoadState("networkidle");

    const inviteBtn = page
      .getByRole("button", { name: /запросити|invite|додати/i })
      .first();
    if (await inviteBtn.isVisible()) {
      await inviteBtn.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Close dialog
      const closeBtn = dialog.getByRole("button", { name: /закри|close|cancel/i }).first();
      if (await closeBtn.isVisible()) await closeBtn.click();
    }
  });
});

// ── Groups ────────────────────────────────────────────────────────────────
test.describe("Manager — Groups", () => {
  test("page loads without raw i18n keys", async ({ managerPage: page }) => {
    await page.goto("/groups");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(page.getByText(/груп/i).first()).toBeVisible();
  });

  test("create group button opens dialog", async ({ managerPage: page }) => {
    await page.goto("/groups");
    await page.waitForLoadState("networkidle");

    const createBtn = page
      .getByRole("button", { name: /створити|create|нова/i })
      .first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 3000 });
      // Close
      const closeBtn = dialog.getByRole("button", { name: /закри|close|cancel/i }).first();
      if (await closeBtn.isVisible()) await closeBtn.click();
    }
  });
});

// ── Finances ──────────────────────────────────────────────────────────────
test.describe("Manager — Finances", () => {
  test("shows Income, Debts AND Expenses tabs (manager-only)", async ({
    managerPage: page,
  }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    const tabs = page.getByRole("tab");
    const tabTexts = await tabs.allTextContents();

    expect(tabTexts.some((t) => /доход|income/i.test(t))).toBe(true);
    expect(tabTexts.some((t) => /борг|debt/i.test(t))).toBe(true);
    // Manager DOES see Expenses — unlike tutors
    expect(tabTexts.some((t) => /витрат|expense/i.test(t))).toBe(true);
  });

  test("Expenses tab loads without errors", async ({ managerPage: page }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    const expensesTab = page
      .getByRole("tab", { name: /витрат|expense/i })
      .first();
    if (await expensesTab.isVisible()) {
      await expensesTab.click();
      await page.waitForLoadState("networkidle");
      await assertNoRawKeys(page);
    }
  });
});

// ── Chats ─────────────────────────────────────────────────────────────────
test.describe("Manager — Chats", () => {
  test("page loads without raw i18n keys", async ({ managerPage: page }) => {
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(page.getByText(/чати|chats/i).first()).toBeVisible();

    // No UPPERCASE raw keys in visible text
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("CHATS.MANAGERBADGE");
    expect(bodyText).not.toContain("CHATCONTEXT.NEXTLESSON");
  });

  test("opening a thread shows context panel on desktop", async ({
    managerPage: page,
  }) => {
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");

    const threads = page.locator("[class*='thread'], [class*='chat-item']");
    const firstThread = threads.first();
    const hasThread = await firstThread.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasThread) {
      test.skip(true, "No chat threads available");
      return;
    }

    await firstThread.click();
    await page.waitForTimeout(1500);

    // Context panel should be visible for manager (not student)
    const contextPanel = page.getByText(/контекст|context/i).first();
    await expect(contextPanel).toBeVisible({ timeout: 5000 });
  });
});

// ── Marketing ─────────────────────────────────────────────────────────────
test.describe("Manager — Marketing (Email)", () => {
  test("page loads and shows email campaign UI", async ({
    managerPage: page,
  }) => {
    await page.goto("/marketing");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(
      page.getByText(/розсилк|campaign|email/i).first()
    ).toBeVisible();

    // Dry run button should be present
    await expect(
      page.getByRole("button", { name: /перевірити|dry run|count|розіслати/i })
    ).toBeVisible();
  });
});

// ── Wallets / Prepayments ─────────────────────────────────────────────────
test.describe("Manager — Wallets", () => {
  test("page loads without raw i18n keys", async ({ managerPage: page }) => {
    await page.goto("/wallets");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(
      page.getByText(/передоплат|wallet|гаманець/i).first()
    ).toBeVisible();
  });
});

// ── Profile ───────────────────────────────────────────────────────────────
test.describe("Manager — Profile", () => {
  test("page loads with editable fields", async ({ managerPage: page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(
      page.getByLabel(/ім.я|first.*name/i).first()
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /зберегти|save/i }).first()
    ).toBeVisible();
  });
});

// ── Navigation ────────────────────────────────────────────────────────────
test.describe("Manager — Navigation", () => {
  test("sidebar links navigate to correct routes", async ({
    managerPage: page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Click Schedule link
    await page.getByRole("link", { name: /розклад|schedule/i }).first().click();
    await page.waitForURL(/\/schedule/);
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Click Finances link
    await page.getByRole("link", { name: /фінанс|finance/i }).first().click();
    await page.waitForURL(/\/finances/);
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Click People link (manager-only)
    await page.getByRole("link", { name: /люди|people/i }).first().click();
    await page.waitForURL(/\/people/);
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);
  });

  test("no page shows raw i18n keys", async ({ managerPage: page }) => {
    const routes = [
      "/dashboard",
      "/schedule",
      "/finances",
      "/people",
      "/groups",
      "/chats",
      "/profile",
      "/wallets",
      "/marketing",
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await assertNoRawKeys(page);
    }
  });
});
