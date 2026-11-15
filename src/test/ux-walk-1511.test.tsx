/**
 * Прохід 15.11 «кожен екран, кожна кнопка, кожна роль» (запит власниці: мінімум кроків,
 * нуль тупиків, нуль роздумів, застосунок веде сам). Кожна знахідка, яку закрито кодом,
 * тримається тут — щоб не повернулась тихо.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }),
  },
}));

describe("онбординг не тримає людину на зробленому кроці", () => {
  it("перший незроблений крок рахується від поточного", async () => {
    const { firstUndoneStep, ALL_STEPS } = await import("@/lib/onboardingSteps");
    const core = ALL_STEPS.filter((s) => s.group === "essential");
    const done = new Set(core.slice(0, 2).map((s) => s.id));
    expect(firstUndoneStep(core, (s) => done.has(s.id))).toBe(2);
    expect(firstUndoneStep(core, () => true)).toBe(-1);
    expect(firstUndoneStep(core, () => false, 1)).toBe(1);
  });

  it("«Зроблю пізніше» памʼятається на пристрої", async () => {
    const { deferOnboarding, onboardingDeferred } = await import("@/lib/onboardingSteps");
    expect(onboardingDeferred("u-1")).toBe(false);
    deferOnboarding("u-1");
    expect(onboardingDeferred("u-1")).toBe(true);
    expect(onboardingDeferred("u-2")).toBe(false);
  });

  it("дашборд не тягне в майстер того, хто відклав, і каже майстру, що привів сам", () => {
    const dp = read("src/pages/DashboardPage.tsx");
    expect(dp).toMatch(/if \(onboardingDeferred\(user\.id\)\) return;/);
    expect(dp).toMatch(/navigate\("\/onboarding", \{ replace: true, state: \{ auto: true \} \}\);/);
  });

  it("майстер перестрибує зроблені кроки, а привезений дашбордом — тихо завершується", () => {
    const ob = read("src/components/OnboardingFlowB.tsx");
    expect(ob).toMatch(/const next = firstUndoneStep\(CORE, isDone, idx\);/);
    expect(ob, "лише коли людина нічого не робила в цей візит і все справді зроблено")
      .toMatch(/if \(autoArrival && completed\.size === 0 && CORE\.every\(isDone\)\)/);
    expect(ob, "предмет читається окремо — без нього «усе зроблено» рахувалось би зарано")
      .toMatch(/const progressReady = !progressLoading && subjectChecked;/);
    expect(ob, "«Назад» — свідомий крок, перестрибування не повертає вперед")
      .toMatch(/manualBack\.current = true; setIdx/);
    expect(ob).toMatch(/if \(user\) deferOnboarding\(user\.id\);/);
  });
});

describe("гейміфікація вимкнена всюди однаково (рада 26.10, рішення 01.11)", () => {
  it("один вимикач, і він вимкнений", () => {
    expect(read("src/lib/gamification.ts")).toMatch(/export const GAMIFICATION_VISIBLE = false;/);
  });
  it("XP в онбордингу не рендериться", () => {
    const ob = read("src/components/OnboardingFlowB.tsx");
    expect(ob).toMatch(/function XpSticker[\s\S]{0,200}if \(!GAMIFICATION_VISIBLE\) return null;/);
    expect(read("src/components/StepVictoryOverlay.tsx")).toMatch(/\{GAMIFICATION_VISIBLE && \(/);
  });
  it("«Досягнення» зникають з меню обох ролей", () => {
    const side = read("src/components/AppSidebar.tsx");
    expect(side).toMatch(/to: "\/achievements"[^\n]*gamified: true/);
    expect(side).toMatch(/to: "\/student\/achievements"[^\n]*gamified: true/);
    expect(side).toMatch(/if \(item\.gamified && !GAMIFICATION_VISIBLE\) return false;/);
  });
  it("кабінет учня: без рівнів, серій, тостів ачівок і посилання на досягнення", () => {
    const sd = read("src/pages/student/StudentDashboardPage.tsx");
    expect(sd).toMatch(/\{GAMIFICATION_VISIBLE && \(\s*<>\s*<StudentProgressBar/);
    expect(sd).toMatch(/useStudentAchievementCelebration\(achievements, rewardsLoading \|\| !GAMIFICATION_VISIBLE/);
    expect(read("src/pages/student/StudentProfilePage.tsx")).toMatch(/\{GAMIFICATION_VISIBLE && \(/);
    expect(read("src/components/student/RewardCollection.tsx")).toMatch(/\{GAMIFICATION_VISIBLE && \(\s*<Link to="\/student\/achievements"/);
  });
});

describe("кабінет учня: одна дія, жодного числа двічі", () => {
  const BASE = {
    hasTutor: true, upcomingCount: 0, nextStartsAt: null, nextSubject: null, nextMeetingUrl: null,
    pendingPaymentsCount: 0, homeworkCount: 0, weeklyCount: 0, weeklyRecord: 0, lessonsBalance: null,
  };
  it("борг — головна дія; плитка з тим самим числом не показується", async () => {
    const { pickStudentNext } = await import("@/components/StudentNextBlock");
    expect(pickStudentNext({ ...BASE, pendingPaymentsCount: 8 })).toBe("debt");
    const sd = read("src/pages/student/StudentDashboardPage.tsx");
    expect(sd).toMatch(/const showPayTile = pendingPaymentsCount > 0 && nextKey !== "debt";/);
    expect(sd).toMatch(/const showHomeworkTile = homeworkCount > 0 && nextKey !== "homework";/);
  });
  it("серія тижнів більше не стає «головною дією»", async () => {
    const { pickStudentNext } = await import("@/components/StudentNextBlock");
    expect(pickStudentNext({ ...BASE, weeklyCount: 0, weeklyRecord: 4 })).toBe("empty");
  });
  it("учень без реквізитів школи може сказати «Я оплатив(ла)»", () => {
    const sp = read("src/pages/student/StudentPaymentsPage.tsx");
    expect(sp).toMatch(/const tutorsDueWithoutDetails = tutorPayInfos\.filter\(/);
    expect(sp).toMatch(/\{tutorsDueWithoutDetails\.map\(\(tp\) => \([\s\S]{0,600}<IPaidButton/);
  });
});

describe("сповіщення ведуть учня в ЙОГО розклад", () => {
  it("/schedule → /student/schedule лише для учня, з тим самим уроком", async () => {
    const { linkForReader } = await import("@/components/NotificationBell");
    expect(linkForReader("/schedule", true)).toBe("/student/schedule");
    expect(linkForReader("/schedule?lesson=abc", true)).toBe("/student/schedule?lesson=abc");
    expect(linkForReader("/schedule", false)).toBe("/schedule");
    expect(linkForReader("/schedules-x", true)).toBe("/schedules-x");
    expect(linkForReader("/student/payments", true)).toBe("/student/payments");
  });
});

describe("день менеджера — не чужі конспекти", () => {
  const lesson = (over: Record<string, unknown>) => ({
    id: "l1", starts_at: new Date(Date.now() - 3 * 3600_000).toISOString(), duration_minutes: 60,
    subject: "Іспанська", status: "completed", student_id: "s1", tutor_id: "tutor-x", studentName: "Соломія", ...over,
  });
  const props = {
    tomorrow: { count: 0, firstTime: null }, pendingCount: 0,
    onJoin: () => {}, onComplete: () => {}, onWriteSummary: () => {}, onCloseDay: () => {},
    onPlanNext: () => {}, onOpenSchedule: () => {},
  };
  it("менеджер, що не викладає, бачить, що день школи триває", async () => {
    const { DayBlock } = await import("@/components/DayBlock");
    render(
      <DayBlock {...props} isOwnLesson={(l) => l.tutor_id === "me"} lessons={[
        lesson({ id: "done" }),
        lesson({ id: "later", status: "scheduled", starts_at: new Date(Date.now() + 5 * 3600_000).toISOString() }),
      ] as never} />,
    );
    expect(screen.queryByText(/Конспект|summar/i)).toBeNull();
    expect(screen.getByText(/dayBlock\.schoolTodayTitle|У школі сьогодні/)).toBeTruthy();
  });
  it("репетитор (без фільтра) і далі бачить свої дії", () => {
    const db = read("src/components/DayBlock.tsx");
    expect(db).toMatch(/const own = useMemo\(\(\) => \(isOwnLesson \? sorted\.filter\(isOwnLesson\) : sorted\)/);
    expect(db, "позначити проведеним може і менеджер — justPast по всіх уроках")
      .toMatch(/const justPast = sorted\.find/);
    expect(read("src/pages/DashboardPage.tsx")).toMatch(/isOwnLesson=\{isManager \? \(l\) => l\.tutor_id === user\?\.id : undefined\}/);
  });
});

describe("гроші: майбутній урок не стає «проведеним» від випадкового дотику", () => {
  it("питаємо лише коли урок ще не почався", () => {
    const h = read("src/hooks/useLessonStatus.ts");
    expect(h).toMatch(/if \(Number\.isFinite\(startMs\) && startMs > Date\.now\(\)\) \{\s*const sure = await confirmDialog\(/);
    expect(h).toMatch(/if \(!sure\) return false;/);
  });
});

describe("слова: одне поняття — одне слово, числа узгоджені", () => {
  const uk = read("src/i18n/locales/uk.ts");
  it("«репетитор», а не «тьютор»", () => {
    expect(uk).not.toMatch(/тьютор/);
  });
  it("школа, а не «хаб» — у тому, що бачать репетитор і менеджер школи", () => {
    for (const k of ["hubChip", "payoutDueTitle", "hubManager", "hubStudents", "hubMargin"]) {
      expect(uk).not.toMatch(new RegExp(`\\b${k}: "[^"]*[Хх]аб`));
    }
  });
  it("підписи під числом узгоджуються з числом", () => {
    expect(uk).toMatch(/hubStudentsLabel_one: "учень школи"/);
    expect(uk).toMatch(/hubStudentsLabel_few: "учні школи"/);
    expect(uk).toMatch(/lessonsTodayLabel_one: "урок сьогодні"/);
    const dp = read("src/pages/DashboardPage.tsx");
    expect(dp).toMatch(/t\("hubTutor\.hubStudentsLabel", \{ count: hubStudentCount \?\? 0 \}\)/);
    expect(dp).toMatch(/t\("hubTutor\.lessonsTodayLabel", \{ count: hubLessonsTodayCount \}\)/);
    expect(dp, "«6 уроки» / «1 Урок» — саморобна множина").not.toMatch(/=== 1 \? t\("lessonCard\.lesson"\) : t\("lessonCard\.lessons"\)/);
  });
  it("питання про урок — без «з Ірина Коваль»", () => {
    expect(uk).toMatch(/reviewPrompt: \{\s*title: "Як пройшов урок\?",/);
  });
});

describe("репетиторка школи не бачить «Очікують оплати»", () => {
  it("чип у шапці — лише менеджеру й самостійній", () => {
    expect(read("src/pages/DashboardPage.tsx")).toMatch(/\{pendingPayments\.length > 0 && !isHubTutor && \(/);
  });
});

describe("лендінг: бульбашка підтримки не накриває головну дію першого екрана", () => {
  it("зʼявляється після прокрутки першого екрана або за 25 с", () => {
    const b = read("src/components/landing/LandingSupportBubble.tsx");
    expect(b).not.toMatch(/setTimeout\(\(\) => setHidden\(false\), 2500\)/);
    expect(b).toMatch(/if \(window\.scrollY > window\.innerHeight \* 0\.6\) reveal\(\);/);
    expect(b).toMatch(/window\.setTimeout\(reveal, 25000\)/);
  });
});

describe("жодної мертвої кнопки в рядку учня", () => {
  it("учень без акаунта: замість сірого чату — «Запросити»", async () => {
    const { PersonCard } = await import("@/components/PersonCard");
    const onInvite = vi.fn();
    const onWrite = vi.fn();
    const { MemoryRouter } = await import("react-router-dom");
    render(
      <MemoryRouter>
        <PersonCard id="s1" name="Тимур Бондар" status="pending" subLine="Англійська" isPending
          onOpen={() => {}} onWrite={onWrite} onInvite={onInvite} />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: /personCard\.invite|Запросити/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    btn.click();
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onWrite).not.toHaveBeenCalled();
    expect(read("src/pages/MyStudentsPage.tsx")).toMatch(/onInvite=\{\(\) => setInvite\(\{ open: true, name, email: s\.email/);
  });
});

describe("«Люди»: перший екран — учні, фільтри лише коли є що фільтрувати", () => {
  it("вкладка за замовчуванням — учні; пігулки статусу — для довгого списку, архіву або ввімкненого фільтра", () => {
    const pp = read("src/pages/PeoplePage.tsx");
    expect(pp).toMatch(/useState<"tutors" \| "students" \| "managers">\("students"\)/);
    expect(pp).toMatch(/const showStatusPills = statusFilter !== "all" \|\| tabPeople\.length >= 6 \|\| tabPeople\.some\(\(u\) => !!u\.archived_at\);/);
    expect(pp).toMatch(/\{!loading && !loadError && showStatusPills && \(/);
  });
});

describe("скринька звернень: заявка на школу — словами, а не ключем", () => {
  it("категорія school_request має переклад і свій значок", () => {
    for (const f of ["uk", "en", "sv"]) {
      expect(read(`src/i18n/locales/${f}.ts`)).toMatch(/category_school_request: "/);
    }
    expect(read("src/pages/FeedbackInboxPage.tsx")).toMatch(/school_request: \{ icon: School/);
  });
});
