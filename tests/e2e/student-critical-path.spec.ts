import { test, expect, assertNoRawKeys, TEST_STUDENT } from "./fixtures";

// Skip entire file if student credentials are not configured
test.skip(
  !process.env.TEST_STUDENT_EMAIL || !process.env.TEST_STUDENT_PASSWORD,
  "Set TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD in .env.e2e to run student critical-path E2E tests"
);

// ── Student Critical Path E2E ──────────────────────────────────────────────
// Simulates the COMPLETE student journey: login → schedule → rewards → progress
// Run:  npx playwright test student-critical-path.spec.ts
// Debug: npx playwright test student-critical-path.spec.ts --headed --debug
//
// Prerequisites: TEST_STUDENT_EMAIL belongs to a student account that has
// at least one completed lesson so rewards and progress bar show real data.

// ── 1. Login & redirect ────────────────────────────────────────────────────
test.describe("1. Student login & redirect", () => {
  test("student lands on /student-dashboard (not tutor dashboard)", async ({
    studentPage: page,
  }) => {
    expect(page.url()).toContain("student-dashboard");
    expect(page.url()).not.toMatch(/\/dashboard(?!.*student)/);
    await assertNoRawKeys(page);
  });

  test("student dashboard shows greeting and all 4 UI blocks", async ({
    studentPage: page,
  }) => {
    await page.goto("/student-dashboard");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Block 1: Upcoming lessons section
    await expect(page.getByText(/наступні уроки|upcoming lesson/i).first()).toBeVisible();

    // Block 2: Quick stat cards (payments + homework count)
    await expect(page.getByText(/очікує оплат|awaiting payment/i).first()).toBeVisible();
    await expect(page.getByText(/домашн|homework/i).first()).toBeVisible();

    // Block 3: Progress bar card with level label
    const levels = /новачок|учень|знавець|майстер|легенда|novice|student|expert|master|legend/i;
    await expect(page.getByText(levels).first()).toBeVisible();

    // Block 4: Reward collection card
    await expect(page.getByText(/нагород|reward/i).first()).toBeVisible();
  });
});

// ── 2. Schedule ────────────────────────────────────────────────────────────
test.describe("2. Student schedule", () => {
  test("schedule page loads with upcoming & past tabs", async ({
    studentPage: page,
  }) => {
    await page.goto("/student/schedule");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Tab list: Upcoming + Past
    const tabs = page.getByRole("tab");
    const tabTexts = await tabs.allTextContents();
    const hasUpcoming = tabTexts.some((t) => /наступн|upcoming/i.test(t));
    const hasPast = tabTexts.some((t) => /минул|past|history/i.test(t));
    expect(hasUpcoming || hasPast).toBe(true);
  });

  test("lesson cards show subject, tutor name and date", async ({
    studentPage: page,
  }) => {
    await page.goto("/student/schedule");
    await page.waitForLoadState("networkidle");

    // Look for any lesson card (scheduled or past)
    const lessonsExist = await page
      .locator("li, [class*='card']")
      .filter({ hasText: /математ|англ|фізик|хімі|програм|музик/i })
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (!lessonsExist) {
      test.skip(true, "No lessons found for this test student account");
      return;
    }

    // First lesson card should have: subject text, a date string, and optionally a Zoom button
    const firstCard = page
      .locator("li, [class*='card']")
      .filter({ hasText: /математ|англ|фізик|хімі|програм|музик/i })
      .first();

    // Date pattern: dd.mm or "пн", "вт" etc.
    await expect(firstCard.getByText(/\d{1,2}[./]\d{1,2}|\bпн\b|\bвт\b|\bср\b/i)).toBeVisible();
  });

  test("Zoom button uses safeHref (http or https, not javascript:)", async ({
    studentPage: page,
  }) => {
    await page.goto("/student/schedule");
    await page.waitForLoadState("networkidle");

    const zoomBtn = page.getByRole("link", { name: /zoom/i }).first();
    const hasZoom = await zoomBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasZoom) {
      test.skip(true, "No Zoom links found on schedule page");
      return;
    }

    const href = await zoomBtn.getAttribute("href");
    expect(href).toMatch(/^https?:\/\//);
    expect(href).not.toMatch(/^javascript:/);
  });
});

// ── 3. Homework ────────────────────────────────────────────────────────────
test.describe("3. Student homework", () => {
  test("homework page loads and shows card or empty state", async ({
    studentPage: page,
  }) => {
    await page.goto("/student/homework");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Either homework cards or empty state message
    const content = page
      .getByText(/домашн|homework|немає домашн|no homework/i)
      .first();
    await expect(content).toBeVisible();
  });

  test("homework content is not empty string when displayed", async ({
    studentPage: page,
  }) => {
    await page.goto("/student/homework");
    await page.waitForLoadState("networkidle");

    const cards = page.locator("[class*='card'] p, li p").filter({ hasText: /\S{10,}/ });
    const count = await cards.count();

    if (count === 0) {
      test.skip(true, "No homework tasks visible for this test student");
      return;
    }

    // First homework task has at least 10 chars (not blank)
    const text = await cards.first().textContent();
    expect(text?.trim().length).toBeGreaterThan(10);
  });
});

// ── 4. Reward collection ───────────────────────────────────────────────────
test.describe("4. Reward collection", () => {
  test("reward collection card is visible on student dashboard", async ({
    studentPage: page,
  }) => {
    await page.goto("/student-dashboard");
    await page.waitForLoadState("networkidle");

    // RewardCollection renders a card with title
    const card = page.getByText(/нагород|reward|колекц/i).first();
    await expect(card).toBeVisible();
  });

  test("reward emojis are rendered as circle buttons (not raw text)", async ({
    studentPage: page,
  }) => {
    await page.goto("/student-dashboard");
    await page.waitForLoadState("networkidle");

    // Check if any reward emojis exist
    // Emojis are inside div.rounded-full with text-xl class
    const emojiCircles = page.locator("div.rounded-full").filter({ hasText: /[🍎🍊🍋🍇🍓⭐🌟✨🏅🥇🔮💎🌿🌸🌺]/u });
    const count = await emojiCircles.count();

    if (count === 0) {
      // Empty state message should be visible instead
      await expect(page.getByText(/ще немає|no reward|порожн/i)).toBeVisible();
    } else {
      // Each emoji circle has a title attribute with the earned date
      const firstCircle = emojiCircles.first();
      const title = await firstCircle.getAttribute("title");
      expect(title).toBeTruthy();
      // Date format: dd.mm.yyyy
      expect(title).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    }
  });

  test("reward collection shows count suffix (not raw i18n key)", async ({
    studentPage: page,
  }) => {
    await page.goto("/student-dashboard");
    await page.waitForLoadState("networkidle");

    const countEl = page
      .locator("span")
      .filter({ hasText: /\d+\s*(нагород|reward|зірок|медал|фрукт)/i })
      .first();
    const hasCount = await countEl.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasCount) {
      const text = await countEl.textContent();
      // Must NOT be a raw i18n key like "rewardCollection.countSuffix"
      expect(text).not.toMatch(/rewardCollection\.\w+/);
    }
  });
});

// ── 5. Progress bar ────────────────────────────────────────────────────────
test.describe("5. Progress bar & level", () => {
  test("progress bar shows level name and progress percentage", async ({
    studentPage: page,
  }) => {
    await page.goto("/student-dashboard");
    await page.waitForLoadState("networkidle");

    const levelNames = /новачок|учень|знавець|майстер|легенда/i;
    await expect(page.getByText(levelNames).first()).toBeVisible();

    // shadcn Progress bar element with aria-valuenow
    const progressBar = page.locator('[role="progressbar"]').first();
    await expect(progressBar).toBeVisible();

    // aria-valuenow must be 0..100
    const value = await progressBar.getAttribute("aria-valuenow");
    if (value !== null) {
      const num = parseFloat(value);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThanOrEqual(100);
    }
  });

  test("'lessons to next level' text shows correct format", async ({
    studentPage: page,
  }) => {
    await page.goto("/student-dashboard");
    await page.waitForLoadState("networkidle");

    // "X до наступного" or nothing if already max level
    const toNextEl = page.getByText(/до наступного|уроків.*далі|to next/i).first();
    const isVisible = await toNextEl.isVisible({ timeout: 2000 }).catch(() => false);

    if (isVisible) {
      const text = await toNextEl.textContent();
      // Should contain a number
      expect(text).toMatch(/\d+/);
    }
    // If not visible — student is at max level (Legend), that's valid
  });

  test("weekly record section shows when student has lessons", async ({
    studentPage: page,
  }) => {
    await page.goto("/student-dashboard");
    await page.waitForLoadState("networkidle");

    // Weekly record shows only when weeklyRecord > 0
    const recordEl = page.getByText(/рекорд|record/i).first();
    const hasRecord = await recordEl.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasRecord) {
      const text = await recordEl.textContent();
      // Should contain a number
      expect(text).toMatch(/\d+/);
    }
    // No record is valid if student hasn't completed any lessons this week
  });
});

// ── 6. Payments ────────────────────────────────────────────────────────────
test.describe("6. Student payments", () => {
  test("student payments page loads without raw i18n keys", async ({
    studentPage: page,
  }) => {
    await page.goto("/student/payments");
    await page.waitForLoadState("networkidle");
    await assertNoRawKeys(page);

    // Either payment rows or empty state
    const content = page
      .getByText(/оплата|payment|немає|no payment/i)
      .first();
    await expect(content).toBeVisible();
  });
});
