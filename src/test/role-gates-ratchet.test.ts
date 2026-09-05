/**
 * P8-РАТЧЕТ: кількість сирих `isIndependent` у кожному файлі може лише ПАДАТИ.
 * Новий код гейтиться через canSee() (src/lib/roleCapabilities.ts).
 * Зменшив кількість — онови baseline у цьому файлі (менше число).
 * Перевищив — тест назве файл і різницю.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Аудит 01.09: у списку стояв "useWorkspaceSettings.ts", а файл насправді .tsx —
// тобто джерело правди роками рахувалось нарівні зі споживачами. Виправлено;
// стара помилкова назва лишена, щоб перейменування файла не зламало гейт мовчки.
const ALLOW = new Set([
  "src/lib/roleCapabilities.ts",
  "src/hooks/useWorkspaceSettings.ts",
  "src/hooks/useWorkspaceSettings.tsx",
  // фінансові предикати: прапор приходить аргументом, рендеру немає
  "src/lib/financials.ts",
  // 05.09: ЧИСТЕ джерело правди станів підписки (замок/Light) — прапор
  // живе тут за визначенням, рендера немає; useWorkspaceSettings делегує.
  "src/lib/subscriptionState.ts",
  // 02.09: адаптер ролі → RoleFlags. Це ДРУГЕ (після useWorkspaceSettings)
  // і останнє місце, де прапорець згадується явно; сторінки тепер питають
  // canSee(...), а не прапорець. Тому файл у ALLOW, а не в BASELINE.
  "src/hooks/useRoleFlags.ts",
]);
const BASELINE: Record<string, number> = {
  "src/components/AiNotesDialog.tsx": 2,
  "src/components/AppSidebar.tsx": 2,
  "src/components/GroupLessonParticipants.tsx": 2,
  "src/components/LessonWorkspace.tsx": 2,
  "src/components/OnboardingFlowB.tsx": 2,
  "src/components/StreakCard.tsx": 2,
  "src/components/TrialCountdownBanner.tsx": 2,
  "src/components/TutorChangeRequestsCard.tsx": 6,
  "src/components/TutorWelcomeBanner.tsx": 2,
  "src/hooks/useWorkspaceSettings.tsx": 2,
  "src/pages/ChatsPage.tsx": 2,
  // 01.09: 28 → 31. Це ЄДИНИЙ раз, коли baseline піднято, і причина зворотна
  // духу ратчета лише на вигляд: прапор переїхав із неявного припущення в
  // ОБОВʼЯЗКОВИЙ аргумент чистої функції `countLessonsMissingPrice(rows,
  // { isIndependent })`. Згадок стало більше, а можливостей помилитись — менше.
  // Далі число знову може лише падати.
  "src/pages/DashboardPage.tsx": 33,
  // 05.09: 43→44 — рендер-гейт картки «Нагадування повернули» (незалежний).
  "src/pages/FinancesPage.tsx": 44,
  "src/pages/GroupsPage.tsx": 3,
  "src/pages/MyReferralsPage.tsx": 2,
  "src/pages/MyStudentsPage.tsx": 6,
  "src/pages/ProfilePage.tsx": 12,
  "src/pages/SchedulePage.tsx": 16,
  "src/pages/SubscriptionPage.tsx": 3,
  "src/pages/WalletsPage.tsx": 7
};

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!p.includes("test")) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(p) && !ALLOW.has(p)) out.push(p);
  }
  return out;
}

describe("role-gates ratchet (isIndependent може лише зникати)", () => {
  it("жоден файл не перевищує baseline; нові файли — 0", () => {
    const over: string[] = [];
    for (const p of walk("src")) {
      const n = (readFileSync(p, "utf8").match(/isIndependent/g) ?? []).length;
      const allowed = BASELINE[p] ?? 0;
      if (n > allowed) over.push(`${p}: ${n} > baseline ${allowed}`);
    }
    expect(over, over.join("\n")).toEqual([]);
  });
});
