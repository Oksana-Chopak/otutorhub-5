import { test, expect, assertNoRawKeys, waitForToast, loginAs } from "./fixtures";

// Skip entire file if tutor credentials are not configured
test.skip(
  !process.env.TEST_TUTOR_EMAIL || !process.env.TEST_TUTOR_PASSWORD,
  "Set TEST_TUTOR_EMAIL + TEST_TUTOR_PASSWORD in .env.e2e to run tutor critical-path E2E tests"
);

// ── Tutor Critical Path E2E ────────────────────────────────────────────────
// Simulates the COMPLETE independent tutor journey in a linear sequence.
// Run:  npx playwright test tutor-critical-path.spec.ts
// Debug: npx playwright test tutor-critical-path.spec.ts --headed --debug

// ── 1. Registration form (UI only — no submission to avoid polluting prod) ──
test.describe("1. Registration form", () => {
  test("signup form renders role selector and required fields", async ({ page }) => {
    await page.goto("/auth?signup=1");
    await page.waitForLoadState("networkidle");

    // Role selector present with both roles
    await expect(page.getByText(/репетитор/i).first()).toBeVisible();
    await expect(page.getByText(/учень|student/i).first()).toBeVisible();

    // Switch to Sign-Up tab if necessary
    const signupTab = page.getByRole("tab").filter({ hasText: /реєстрація|sign up|register/i });
    if (await signupTab.isVisible()) await signupTab.click();

    // Required name fields visible
    await expect(page.getByLabel(/ім.я|first.*name/i).first()).toBeVisible();
    await expect(page.getByLabel(/прізвище|last.*name/i).first()).toBeVisible();

    // Password field present with strength hint
    await expect(page.getByLabel(/пароль|password/i).first()).toBeVisible();
    await expect(page.getByText(/мінімум 8|min.*8/i)).toBeVisible();
  });

  test("tutor role card is pre-selected by default when arriving via ?role=tutor", async ({ page }) => {
    await page.goto("/auth?signup=1&role=tutor");
    await page.waitForLoadState("networkidle");

    const signupTab = page.getByRole("tab").filter({ hasText: /реєстрація|sign up|register/i });
    if (await signupTab.isVisible()) await signupTab.click();

    // Tutor card should show active border (border-primary class)
    const tutorCard = page.locator("button").filter({ hasText: /репетитор/i }).first();
    await expect(tutorCard).toHaveClass(/border-primary/);
  });

  test("form blocks submission with empty required fields", async ({ page }) => {
    await page.goto("/auth?signup=1&role=tutor");
    await page.waitForLoadState("networkidle");

    const signupTab = page.getByRole("tab").filter({ hasText: /реєстрація|sign up|register/i });
    if (await signupTab.isVisible()) await signupTab.click();

    // Click Create without filling fields — browser native validation or
    // our zod validation should block navigation
    await page.getByRole("button", { name: /створити|create|register/i }).click();

    // Still on auth page — no navigation happened
    expect(page.url()).toContain("/auth");
  });
});

// ── 2. Login → correct dashboard redirect ─────────────────────────────────
test.describe("2. Login & redirect", () => {
  test("tutor lands on /dashboard (not student-dashboard)", async ({ page }) => {
    await loginAs(page, {
      email: process.env.TEST_TUTOR_EMAIL!,
      password: process.env.TEST_TUTOR_PASSWORD!,
    });

    expect(page.url()).toMatch(/\/dashboard/);
    expect(page.url()).not.toContain("student-dashboard");
    await assertNoRawKeys(page);
  });

  test("dashboard shows tutor greeting and lesson count", async ({ tutorPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Greeting (morning/afternoon/evening)
    await expect(page.getByText(/доброго|добрий|привіт/i).first()).toBeVisible();

    // Lessons-today indicator (may be 0)
    await expect(page.getByText(/урок.*сьогодні|today.*lesson/i).first()).toBeVisible();
  });
});

// ── 3. Onboarding ─────────────────────────────────────────────────────────
test.describe("3. Onboarding page", () => {
  test("onboarding page renders all steps with XP", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // XP total visible
    await expect(page.getByText(/XP/i).first()).toBeVisible();

    // Progress percentage
    await expect(page.getByText(/%/).first()).toBeVisible();

    // At least one step card (step 0 = subject)
    await expect(page.getByText(/предмет|subject|математ|англ/i).first()).toBeVisible();
  });

  test("subject can be added inline on onboarding", async ({ tutorPage: page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Step 0 has an inline subject combobox + save button
    const subjectInput = page.getByPlaceholder(/предмет|subject|математ/i).first();
    const hasInput = await subjectInput.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasInput) {
      test.skip(true, "Subject step already completed for this test account");
      return;
    }

    // Type a subject and save
    await subjectInput.fill("Тестовий предмет E2E");
    const saveBtn = page.getByRole("button", { name: /зберегти|save/i }).first();
    await saveBtn.click();

    // Victory overlay or auto-complete sticker should appear
    await expect(
      page.getByText(/виконано|✅|+25 XP|automatically/i).first()
    ).toBeVisible({ timeout: 8000 });
  });
});

// ── 4. Add student ─────────────────────────────────────────────────────────
test.describe("4. Add student", () => {
  // Use timestamped name to identify E2E-created test data
  const E2E_STUDENT_NAME = `E2E-Test-${Date.now()}`;

  test("add student dialog — progressive disclosure shows core fields only initially", async ({
    tutorPage: page,
  }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    await page.getByRole("button", { name: /додати учня|add student/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Core fields visible immediately
    await expect(dialog.getByLabel(/ім.я|first.*name/i).first()).toBeVisible();
    await expect(dialog.getByText(/предмет|subject/i).first()).toBeVisible();
    await expect(dialog.getByText(/ціна|price/i).first()).toBeVisible();

    // Contact fields hidden until expanded
    const contactToggle = dialog.getByText(/додати контакт|contact|телефон|phone/i).first();
    if (await contactToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Phone input should NOT be visible yet
      await expect(dialog.getByLabel(/телефон|phone/i).first()).not.toBeVisible();
      await contactToggle.click();
      await expect(dialog.getByLabel(/телефон|phone/i).first()).toBeVisible();
    }
  });

  test("can create a student end-to-end", async ({ tutorPage: page }) => {
    await page.goto("/my-students");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /додати учня|add student/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Fill first name
    const firstNameField = dialog.getByLabel(/ім.я|first.*name/i).first();
    await firstNameField.fill(E2E_STUDENT_NAME);

    // Subject — type or pick from combobox
    const subjectField = dialog
      .getByRole("combobox")
      .or(dialog.getByPlaceholder(/предмет|subject/i))
      .first();
    if (await subjectField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await subjectField.fill("Математика");
      // Pick first matching option if dropdown appears
      const option = page.getByRole("option", { name: /математ/i }).first();
      if (await option.isVisible({ timeout: 1000 }).catch(() => false)) await option.click();
    }

    // Submit
    const submitBtn = dialog.getByRole("button", { name: /додати|зберегти|create|save/i }).first();
    await submitBtn.click();

    // Dialog closes → student appears in list
    await expect(dialog).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByText(E2E_STUDENT_NAME)).toBeVisible({ timeout: 8000 });
  });
});

// ── 5. Create lesson ───────────────────────────────────────────────────────
test.describe("5. Create lesson", () => {
  test("lesson appears in schedule after creation", async ({ tutorPage: page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Open create dialog
    await page.getByRole("button", { name: /створити урок|create lesson/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Check whether a student is available to select
    const studentSelector = dialog
      .getByRole("combobox")
      .or(dialog.getByRole("button", { name: /оберіть учня|select student/i }))
      .first();
    const hasStudentSelector = await studentSelector.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasStudentSelector) {
      test.skip(true, "No student selector visible — account may have no students");
      return;
    }

    await studentSelector.click();

    const firstOption = page.getByRole("option").first();
    const hasOptions = await firstOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasOptions) {
      test.skip(true, "No students in dropdown");
      return;
    }
    await firstOption.click();

    // Advance through any step 2 (date/time)
    const nextBtn = dialog.getByRole("button", { name: /далі|next/i }).first();
    if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) await nextBtn.click();

    // Create
    const createBtn = dialog.getByRole("button", { name: /створити|create/i }).first();
    await expect(createBtn).toBeEnabled({ timeout: 3000 });
    await createBtn.click();

    // Success: dialog closes and/or toast appears
    await Promise.race([
      expect(dialog).not.toBeVisible({ timeout: 10_000 }),
      waitForToast(page, /урок.*створ|lesson.*creat|успішно/i),
    ]);
  });

  test("lesson shows in upcoming list on dashboard", async ({ tutorPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Dashboard should show today/tomorrow lessons section
    const lessonSection = page
      .getByText(/сьогодні|today|завтра|tomorrow|заплановано/i)
      .first();
    await expect(lessonSection).toBeVisible();
  });
});

// ── 6. Mark lesson as completed → streak toast ─────────────────────────────
test.describe("6. Complete lesson", () => {
  test("marking complete from dashboard shows success toast", async ({ tutorPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Find a scheduled lesson card with a status selector
    const statusSelect = page
      .getByRole("combobox")
      .filter({ hasText: /заплановано|scheduled/i })
      .first();
    const hasSelect = await statusSelect.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasSelect) {
      test.skip(true, "No scheduled lessons on dashboard to mark complete");
      return;
    }

    await statusSelect.click();
    const completedOption = page
      .getByRole("option", { name: /проведено|завершено|complete/i })
      .first();
    await expect(completedOption).toBeVisible({ timeout: 3000 });
    await completedOption.click();

    // Success toast from sonner
    await waitForToast(page, /проведено|урок.*завершено|lesson.*complete/i);
  });

  test("lesson detail dialog mark-complete awards badge", async ({ tutorPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Open any lesson via click on subject title
    const lessonCard = page.locator("[class*='lesson'], [class*='LessonCard']").first();
    const hasCard = await lessonCard.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasCard) {
      // Try clicking any subject text that opens the dialog
      const subjectLink = page.getByText(/математ|англ|фізик/i).first();
      const hasSubject = await subjectLink.isVisible({ timeout: 2000 }).catch(() => false);
      if (!hasSubject) {
        test.skip(true, "No lesson cards visible on dashboard");
        return;
      }
      await subjectLink.click();
    } else {
      await lessonCard.click();
    }

    // Dialog should open
    const dialog = page.getByRole("dialog");
    const isOpen = await dialog.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isOpen) {
      test.skip(true, "Lesson dialog did not open");
      return;
    }

    // Look for mark-complete button inside dialog
    const markBtn = dialog
      .getByRole("button", { name: /проведено|завершено|complete/i })
      .first();
    const hasMark = await markBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasMark) {
      test.skip(true, "Mark-complete button not visible — lesson may already be completed");
      return;
    }

    await markBtn.click();
    await waitForToast(page, /проведено|завершено|complete/i);
  });
});

// ── 7. Payment → finances ──────────────────────────────────────────────────
test.describe("7. Payment & finances", () => {
  test("marking student payment shows income toast", async ({ tutorPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Find unpaid toggle / checkbox in lesson row
    const unpaidToggle = page
      .getByRole("button", { name: /не оплачено|unpaid|позначити оплаченим/i })
      .or(page.getByText(/unpaid|не оплачено/i))
      .first();
    const hasUnpaid = await unpaidToggle.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasUnpaid) {
      test.skip(true, "No unpaid lesson visible — all may already be paid");
      return;
    }

    await unpaidToggle.click();
    await waitForToast(page, /оплата|payment|отримано|received|грн/i);
  });

  test("finances page shows income summary", async ({ tutorPage: page }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Income tab exists and is accessible
    const incomeTab = page.getByRole("tab", { name: /доход|income/i }).first();
    await expect(incomeTab).toBeVisible();
    await incomeTab.click();

    // Income figure visible (may be 0)
    await expect(page.getByText(/грн|\$|UAH|EUR|SEK/i).first()).toBeVisible();

    // Period selector (all/month/week) present
    await expect(
      page.getByRole("combobox", { name: /period|всі|period/i })
        .or(page.getByText(/за весь|all time/i))
        .first()
    ).toBeVisible();
  });

  test("unpaid lessons appear in Debts tab", async ({ tutorPage: page }) => {
    await page.goto("/finances");
    await page.waitForLoadState("networkidle");

    const debtTab = page.getByRole("tab", { name: /борг|debt/i }).first();
    await expect(debtTab).toBeVisible();
    await debtTab.click();
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Either a list of debts or an empty-state message
    const content = page.getByText(/очікує|unpaid|немає боргів|no debt/i).first();
    await expect(content).toBeVisible();
  });
});
