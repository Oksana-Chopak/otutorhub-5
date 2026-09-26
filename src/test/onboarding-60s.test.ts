import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_STEPS, CORE, LATER, CORE_TOTAL } from "@/lib/onboardingSteps";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Важіль 9 (аудит шляхів 24.09): «Онбординг: цінність за 60 секунд».
 *
 * Було сім обовʼязкових кроків, з них три — чисті налаштування. Кожен зайвий
 * крок ДО першого уроку — це частка людей, які не дійшли; а налаштування,
 * показане в момент потреби, вмикають частіше за те саме налаштування в
 * майстрі. Тести тримають рівно ці дві обіцянки — і те, що реалізація кожної
 * дії лишилась ОДНА.
 */
describe("онбординг: цінність за 60 секунд (важіль 9)", () => {
  const flow = () => read("src/components/OnboardingFlowB.tsx");
  const dash = () => read("src/pages/DashboardPage.tsx");

  it("шлях майстра — чотири екрани до цінності, не сім", () => {
    expect(CORE.map((s) => s.action)).toEqual(["subject", "student", "lesson", "debt"]);
    expect(CORE_TOTAL).toBe(4);
    // Банер і бейдж «Новий!» рахують ТОЙ САМИЙ шлях — інакше прогрес бреше.
    expect(read("src/components/TutorWelcomeBanner.tsx")).toMatch(/CORE_TOTAL/);
    expect(read("src/components/AppSidebar.tsx")).toMatch(/CORE_TOTAL/);
  });

  it("налаштування більше не кроки майстра", () => {
    expect(LATER.map((s) => s.action)).toEqual(["proRules", "autoMark", "telegram"]);
    for (const s of LATER) expect(CORE).not.toContain(s);
    expect(flow(), "майстер бере зі шляху лише essential")
      .toMatch(/visibleSteps\.filter\(\(s\) => s\.group === "essential"\)/);
  });

  it("кожне налаштування має СВІЙ момент потреби, а не зʼявляється одразу", () => {
    const d = dash();
    expect(d, "Telegram — коли вже є урок: ранковому дайджесту є що казати")
      .toMatch(/t\.action === "telegram" && lessons\.length === 0/);
    expect(d, "автопозначення — після трьох проведених уроків")
      .toMatch(/t\.action === "autoMark" && conductedCount < 3/);
    expect(d, "правила оплат — коли вже є борг")
      .toMatch(/t\.action === "proRules" && debtors\.length === 0/);
  });

  it("картка веде в ТОЙ САМИЙ майстер — другої реалізації дії немає", () => {
    const d = dash();
    for (const action of ["telegram", "autoMark", "proRules"]) {
      expect(d, `${action} мусить вести в /onboarding?step=`).toContain(`/onboarding?step=${action}`);
    }
    const f = flow();
    expect(f).toMatch(/const singleAction = searchParams\.get\("step"\)/);
    expect(f, "одиночний крок не перезаписує збережений прогрес майстра")
      .toMatch(/if \(singleStep\) \{ navigate\("\/dashboard"\); return true; \}/);
    expect(f, "і не перестрибує на збережений крок").toMatch(/if \(!singleStep && s > 1/);
  });

  it("гроші лишились обовʼязковими і в першій сесії (рішення 13.09)", () => {
    const debt = ALL_STEPS.find((s) => s.action === "debt")!;
    expect(debt.group).toBe("essential");
    expect(CORE[CORE.length - 1].action).toBe("debt");
    expect(flow(), "фінал веде числом, не словами «профіль заповнено»").toMatch(/moneyDebtLabel/);
  });

  it("налаштування лишаються досяжними з фінального екрана", () => {
    expect(flow()).toMatch(/s\.group === "bonus" \|\| s\.group === "setup"/);
  });

  it("школі чужі налаштування не пропонуються (та сама межа, що в майстрі)", () => {
    expect(dash()).toMatch(/isHubTutor && \(t\.action === "proRules" \|\| t\.action === "autoMark"\)/);
    expect(flow()).toMatch(/HUB_SKIP = new Set\(\[[^\]]*"proRules"[^\]]*"autoMark"/);
  });

  it("картку можна прибрати, і це синкається між пристроями", () => {
    const d = dash();
    expect(d).toMatch(/skipTask\(task\.action\)/);
    expect(d, "дісміси живуть у профілі, не лише в браузері").toMatch(/dismissed_tasks/);
  });
});
