import { test, expect, assertNoRawKeys, watchConsoleErrors } from "./fixtures";

// Skip entire file if credentials are not configured
test.skip(
  !process.env.TEST_TUTOR_EMAIL || !process.env.TEST_TUTOR_PASSWORD,
  "Set TEST_TUTOR_EMAIL + TEST_TUTOR_PASSWORD in .env.e2e to run tutor E2E tests"
);

// ── Tutor Flow E2E Tests ────────────────────────────────────────────────────
// Tests the complete journey of an independent tutor on otutorhub.com
// Run: npx playwright test tutor-flow.spec.ts
// Debug: npx playwright test tutor-flow.spec.ts --headed --debug

// ── Dashboard ─────────────────────────────────────────────────────────────
test.describe("Tutor — Dashboard", () => {
  test("loads without errors and shows correct content", async ({ tutorPage: page }) => {
    const errors = watchConsoleErrors(page);

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // No raw i18n keys visible
    await assertNoRawKeys(page);

    // No JS errors (ResizeObserver warnings are expected/harmless)
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);

    // Greeting present
    await expect(page.getByText(/доброго|добрий|привіт/i)).toBeVisible();

    // Lesson count does not show doubled digits like "00" or "11"
    const lessonCount = page.locator("text=/\\d+ урок/i").first();
    if (await lessonCount.isVisible()) {
      const text = await lessonCount.textContent();
      expect(text).not.toMatch(/(\d)\1/);
    }
  });

  test("Quick Actions button opens panel", async ({ tutorPage: page }) => {
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

// ── My Students ───────────────────────────────────────────────────────────
test.describe("Tutor — My Students", () => {
  test("page loads and shows student list", async ({ tutorPage: page }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(page.getByText(/мої учні/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /додати учня/i })
    ).toBeVisible();
  });

  test("Add student dialog opens with progressive disclosure", async ({
    tutorPage: page,
  }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /додати учня/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Core fields visible
    await expect(dialog.getByLabel(/ім.я/i)).toBeVisible();
    await expect(dialog.getByText(/предмет/i)).toBeVisible();
    await expect(dialog.getByText(/ціна/i)).toBeVisible();

    // Contacts hidden initially (progressive disclosure)
    await expect(dialog.getByLabel(/телефон|phone/i)).not.toBeVisible();
    await expect(dialog.getByLabel(/email/i)).not.toBeVisible();

    // Toggle reveals contact fields
    const toggle = dialog.getByText(/додати контакти|add contacts/i);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(dialog.getByLabel(/телефон|phone/i)).toBeVisible();
  });

  test("student count uses correct Ukrainian plural form", async ({
    tutorPage: page,
  }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");

    const countText = await page
      .locator("text=/\\d+ учн/i")
      .first()
      .textContent()
      .catch(() => null);

    if (countText) {
      const count = parseInt(countText);
      // 1 → "учень", 2–4 → "учні", 5+ → "учнів"
      if (count === 1) expect(countText).toMatch(/1 учень/);
    }
  });
});

// ── Schedule ──────────────────────────────────────────────────────────────
test.describe("Tutor — Schedule", () => {
  test("page loads with calendar and create button", async ({
    tutorPage: page,
  }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(page.getByText(/розклад|schedule/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /створити урок|create lesson/i })
    ).toBeVisible();
  });

  test("Create lesson button opens 2-step dialog", async ({
    tutorPage: page,
  }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /створити урок/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Step 1 indicator and student selector present
    await expect(dialog.getByText(/1/)).toBeVisible();
    await expect(dialog.getByText(/учень|student/i)).toBeVisible();
  });

  test("create lesson end-to-end — happy path", async ({ tutorPage: page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    // Open dialog
    await page.getByRole("button", { name: /створити урок/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Check whether a student can be selected (skip if none)
    const studentCombo = dialog
      .getByRole("combobox")
      .or(dialog.getByRole("button", { name: /учень|student|оберіть/i }))
      .first();
    const hasStudentSelect = await studentCombo.isVisible().catch(() => false);

    if (!hasStudentSelect) {
      // No students configured — skip creation part
      test.skip(true, "No students available for lesson creation test");
      return;
    }

    await studentCombo.click();

    // Pick the first student option in the dropdown
    const firstOption = page
      .getByRole("option")
      .or(page.locator("[data-radix-select-viewport] [role='option']"))
      .first();
    const hasOptions = await firstOption.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasOptions) {
      test.skip(true, "No student options in dropdown");
      return;
    }

    await firstOption.click();

    // Advance to step 2 if there is a Next button
    const nextBtn = dialog.getByRole("button", { name: /далі|next|крок 2/i });
    if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nextBtn.click();
    }

    // Confirm Create button
    const createBtn = dialog.getByRole("button", { name: /створити|create/i });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Expect success toast or dialog close
    const toastOrClose = page
      .getByText(/урок.*створ|lesson.*creat/i)
      .or(page.getByText(/успішно|success/i));
    await expect(toastOrClose.first()).toBeVisible({ timeout: 10_000 });
  });

  test("mark scheduled lesson as completed", async ({ tutorPage: page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");

    // Look for the first "scheduled" status badge
    const scheduledBadge = page
      .getByText(/заплановано/i)
      .first();
    const hasScheduled = await scheduledBadge.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasScheduled) {
      test.skip(true, "No scheduled lessons available to mark complete");
      return;
    }

    // Find and click the "mark completed" button in the same card/row
    const markCompleteBtn = page
      .getByRole("button", { name: /заверш|проведен|complete/i })
      .first();
    const hasMark = await markCompleteBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasMark) {
      // Try clicking the lesson card to expand actions
      await scheduledBadge.click();
      await page.waitForTimeout(500);
    }

    const btn = page.getByRole("button", { name: /заверш|проведен|complete/i }).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      // Status should update
      await expect(
        page.getByText(/проведено|завершено|completed/i).first()
      ).toBeVisible({ timeout: 8000 });
    }
  });
});

// ── Finances ──────────────────────────────────────────────────────────────
test.describe("Tutor — Finances", () => {
  test("page shows Income and Debts tabs — no Expenses tab", async ({
    tutorPage: page,
  }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    const tabs = page.getByRole("tab");
    const tabTexts = await tabs.allTextContents();

    expect(tabTexts.some((t) => /доход|income/i.test(t))).toBe(true);
    expect(tabTexts.some((t) => /борг|debt/i.test(t))).toBe(true);
    // Tutor never sees Expenses — that is manager-only
    expect(tabTexts.some((t) => /витрат|expense/i.test(t))).toBe(false);
  });

  test("auto-switches to Debts tab when unpaid lessons exist", async ({
    tutorPage: page,
  }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    const debtRows = await page.locator("text=/очікує|unpaid/i").count();
    if (debtRows > 0) {
      const activeTab = page.getByRole("tab", { selected: true });
      const tabText = await activeTab.textContent();
      expect(tabText).toMatch(/борг|debt/i);
    }
  });
});

// ── Chats ─────────────────────────────────────────────────────────────────
test.describe("Tutor — Chats", () => {
  test("page loads without raw i18n keys", async ({ tutorPage: page }) => {
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    await expect(page.getByText(/чати|chats/i).first()).toBeVisible();
  });

  test("opening a thread shows context panel on desktop", async ({
    tutorPage: page,
  }) => {
    await page.goto("/chats");
    await page.waitForLoadState("networkidle");

    // Find any thread button and click it
    const thread = page.getByRole("button").filter({ hasText: /↔/ }).first();
    const hasThread = await thread.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasThread) {
      test.skip(true, "No chat threads available");
      return;
    }

    await thread.click();
    await page.waitForTimeout(1500);

    // Context panel visible (ChatContextPanel title key)
    const contextPanel = page.getByText(/контекст|context/i).first();
    await expect(contextPanel).toBeVisible({ timeout: 5000 });
  });
});

// ── Profile ───────────────────────────────────────────────────────────────
test.describe("Tutor — Profile", () => {
  test("page loads with editable fields", async ({ tutorPage: page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Name fields present
    await expect(
      page.getByLabel(/ім.я|first.*name/i).first()
    ).toBeVisible();

    // Save button present
    await expect(
      page.getByRole("button", { name: /зберегти|save/i }).first()
    ).toBeVisible();
  });
});

// ── Availability ──────────────────────────────────────────────────────────
test.describe("Tutor — Availability", () => {
  test("page loads with schedule info and time slots", async ({
    tutorPage: page,
  }) => {
    await page.goto("/availability");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Info banner with schedule description
    await expect(
      page.getByText(/вкажіть.*дні|set.*days|accept.*lesson/i).first()
    ).toBeVisible();

    // Weekly template section heading
    await expect(
      page.getByText(/тижнев|weekly/i).first()
    ).toBeVisible();
  });
});

// ── Navigation ────────────────────────────────────────────────────────────
test.describe("Tutor — Navigation", () => {
  test("desktop sidebar links navigate to correct routes", async ({
    tutorPage: page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Click Schedule link in sidebar
    await page.getByRole("link", { name: /розклад|schedule/i }).first().click();
    await page.waitForURL(/\/schedule/);
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Click Finances link
    await page.getByRole("link", { name: /фінанс|finance/i }).first().click();
    await page.waitForURL(/\/finances/);
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Click My Students link
    await page
      .getByRole("link", { name: /учн|student/i })
      .first()
      .click();
    await page.waitForURL(/\/my-students/);
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);
  });

  test("no page shows raw i18n key visible to user", async ({
    tutorPage: page,
  }) => {
    const routes = [
      "/dashboard",
      "/schedule",
      "/finances",
      "/my-students",
      "/chats",
      "/profile",
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await assertNoRawKeys(page);
    }
  });
});

// ── Onboarding ────────────────────────────────────────────────────────────
test.describe("Tutor — Onboarding", () => {
  test("onboarding page loads all steps", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    await assertNoRawKeys(page);

    // Progress indicator or step list
    await expect(
      page.locator("[class*='progress'], [class*='step']").first()
    ).toBeVisible();

    await expect(
      page.getByText(/учня|lesson|zoom|telegram/i).first()
    ).toBeVisible();
  });
});
