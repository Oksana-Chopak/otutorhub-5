/**
 * П3.21 — чотириперсонний тест ЗАПИСІВ (ТЗ власниці; специфікація uxstep35,
 * частина 3 «Готовності до релізу»). Два шари:
 *
 *   Шар A — матриця замка: РЕАЛЬНА продакшн-функція deriveSubscription
 *           (та сама, що виконує useWorkspaceSettings) по всіх станах
 *           4 персон, включно з правилом «поки вантажиться — жодних рішень».
 *
 *   Шар B — трипваєр гейтів запису: кожен грошовий обробник, замкнений
 *           05.09, МУСИТЬ містити guard замка поруч зі своїм оголошенням.
 *           Прибрав guard — CI називає файл і обробник. (Той самий
 *           file-scan-патерн, що вже тримає persona-readiness і ратчети.)
 *
 * Повна рендер-матриця «видно/клікабельно» живе у four-personas.test.tsx;
 * живий прогін запису в БД під 4 персонами — на стенді аудиторки
 * (demo/fake, некомічений) під час спільного смоуку.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSubscription, type SubscriptionSettingsSlice } from "@/lib/subscriptionState";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const iso = (deltaDays: number) => new Date(NOW + deltaDays * DAY).toISOString();

const ws = (over: Partial<SubscriptionSettingsSlice>): SubscriptionSettingsSlice => ({
  independent_workspace: true,
  subscription_status: "free",
  subscription_until: null,
  trial_until: null,
  current_plan: null,
  ...over,
});

const derive = (settings: SubscriptionSettingsSlice | null, extra?: { roleReady?: boolean; workspaceUnknown?: boolean }) =>
  deriveSubscription({ settings, roleReady: extra?.roleReady ?? true, workspaceUnknown: extra?.workspaceUnknown ?? false, now: NOW });

describe("П3.21 · шар A — матриця замка (продакшн-предикат)", () => {
  it("менеджер і учень (хук вимкнено, settings=null) — ніколи не замкнені", () => {
    const f = derive(null);
    expect(f.coreLocked).toBe(false);
    expect(f.isIndependent).toBe(false);
  });

  it("хабовий репетитор — не замкнений за будь-якого статусу підписки", () => {
    for (const status of ["free", "trial", "active", "past_due", "cancelled"] as const) {
      const f = derive(ws({ independent_workspace: false, subscription_status: status }));
      expect(f.coreLocked, `хабовий зі статусом ${status}`).toBe(false);
    }
  });

  it("незалежний у живому тріалі — відкритий, план ПОВНИЙ", () => {
    const f = derive(ws({ subscription_status: "trial", trial_until: iso(+10) }));
    expect(f.coreLocked).toBe(false);
    expect(f.isPro).toBe(true);
    expect(f.hasFullPlan).toBe(true);
  });

  it("незалежний із простроченим тріалом — ЗАМКНЕНИЙ (сценарій реклами)", () => {
    const f = derive(ws({ subscription_status: "trial", trial_until: iso(-1) }));
    expect(f.isPro).toBe(false);
    expect(f.coreLocked).toBe(true);
  });

  it("free / cancelled / past_due незалежного — замкнені", () => {
    for (const status of ["free", "cancelled", "past_due"] as const) {
      const f = derive(ws({ subscription_status: status }));
      expect(f.coreLocked, `статус ${status}`).toBe(true);
    }
  });

  it("активна підписка — відкрита; прострочена active (донвґрейд-крон ще не пройшов) — замкнена", () => {
    const live = derive(ws({ subscription_status: "active", subscription_until: iso(+20), current_plan: "monthly" }));
    expect(live.coreLocked).toBe(false);
    expect(live.hasFullPlan).toBe(true);
    const lapsed = derive(ws({ subscription_status: "active", subscription_until: iso(-2), current_plan: "monthly" }));
    expect(lapsed.isPro).toBe(false);
    expect(lapsed.coreLocked).toBe(true);
  });

  it("Light: ядро відкрите, AI-фічі закриті; тріал НЕ вважається Light", () => {
    const light = derive(ws({ subscription_status: "active", subscription_until: iso(+20), current_plan: "light" }));
    expect(light.coreLocked).toBe(false);
    expect(light.isPro).toBe(true);
    expect(light.hasFullPlan).toBe(false);
    // Людина в тріалі, яка КОЛИСЬ була на light: тріал = повний план.
    const trialAfterLight = derive(ws({ subscription_status: "trial", trial_until: iso(+5), current_plan: "light" }));
    expect(trialAfterLight.hasFullPlan).toBe(true);
  });

  it("uxstep35-правило: поки персона НЕвідома — жодного рішення про замок", () => {
    // Стан завантаження (roleReady=false): прострочений тріал, але замок мовчить.
    const loading = derive(ws({ subscription_status: "trial", trial_until: iso(-1) }), { roleReady: false });
    expect(loading.coreLocked).toBe(false);
    // Запит завершився без рядка (workspaceUnknown): теж не замикаємо — запис
    // гейтять guard'и воркспейсу, а пейвол не блимає невинним.
    const unknown = derive(null, { workspaceUnknown: true });
    expect(unknown.coreLocked).toBe(false);
  });
});

describe("П3.21 · шар B — трипваєр: guard замка стоїть у КОЖНОМУ грошовому обробнику", () => {
  /** handler → файл; тест вимагає guard (lock.locked / coreLock.locked) у тілі обробника. */
  const GUARDED: Array<{ file: string; handler: string }> = [
    { file: "components/QuickLessonDialog.tsx", handler: "const submit = async" },
    { file: "pages/SchedulePage.tsx", handler: "const handleCreate = async" },
    { file: "pages/FinancesPage.tsx", handler: "const togglePayment = async" },
    { file: "pages/DashboardPage.tsx", handler: "const updatePayment = async" },
    { file: "components/GroupLessonParticipants.tsx", handler: "const togglePaid = async" },
    { file: "components/RecordPaymentSheet.tsx", handler: "const handleMarkPaid = async" },
    { file: "components/RecordPaymentSheet.tsx", handler: "const handleTopUp = async" },
    { file: "components/WalletDialog.tsx", handler: "const handleTopUp = async" },
    { file: "components/WalletDialog.tsx", handler: "const handleMarkPaid = async" },
    { file: "components/WalletDialog.tsx", handler: "const handleDelete = async" },
  ];

  it.each(GUARDED)("$file · $handler", ({ file, handler }) => {
    const text = readFileSync(join(src, file), "utf8");
    const at = text.indexOf(handler);
    expect(at, `${file}: обробник «${handler}» зник — онови цей тест свідомо`).toBeGreaterThan(-1);
    // Guard мусить стояти в перших рядках тіла обробника (до першого запису).
    const head = text.slice(at, at + 400);
    const guarded = /(lock|coreLock)\.locked/.test(head) && /openPaywall/.test(head);
    expect(
      guarded,
      `${file}: «${handler}» втратив guard замка (lock.locked → openPaywall) — грошовий запис відкрився без підписки`,
    ).toBe(true);
  });

  it("useCoreLock споживає coreLocked із єдиного джерела (deriveSubscription)", () => {
    const hook = readFileSync(join(src, "hooks/useWorkspaceSettings.tsx"), "utf8");
    expect(hook.includes("deriveSubscription({ settings, roleReady, workspaceUnknown })")).toBe(true);
    const lockHook = readFileSync(join(src, "hooks/useCoreLock.tsx"), "utf8");
    expect(lockHook.includes("coreLocked")).toBe(true);
  });
});
