/**
 * 24.09 — аудит шляхів («де можна спростити шлях, зменшити кількість переходів»).
 * Кожен тест тут стереже одну виправлену пастку: мертву кнопку, тихий дотик,
 * глухий кут або зайвий перехід. Якщо правку відкотити — тест падає.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

describe("аудит шляхів 24.09: мертві кнопки й тихі дотики", () => {
  it("«Призначити репетитора» у формі людини справді відкриває форму", () => {
    const people = src("src/pages/PeoplePage.tsx");
    // Кнопка в PersonEditSheet була без обробника — дотик не робив нічого.
    expect(people).toMatch(/<PersonEditSheet[\s\S]{0,2000}onAssignTutor=\{\(studentId\) =>/);
    expect(people).toMatch(/onAssignTutor=\{\(studentId\) => \{[\s\S]{0,400}setAddTutorToStudent\(\{/);
    expect(src("src/components/PersonEditSheet.tsx")).toMatch(/onClick=\{\(\) => onAssignTutor\?\.\(person\.id\)\}/);
  });

  it("груповий рядок у Фінансах відповідає словами, а не мовчанням", () => {
    const f = src("src/pages/FinancesPage.tsx");
    expect(f).toMatch(/if \(field === "tutor_payout_status" && lesson\.kind === "group"\) \{[\s\S]{0,220}toast\.info\(t\("finances\.groupPayoutNotTracked"\)\)/);
    expect(f, "старий мовчазний return").not.toMatch(/lesson\.kind === "group"\) return;/);
  });

  it("«Нагадати» в чаті завжди видиме: текст додається і фокус іде в поле", () => {
    const c = src("src/pages/ChatsPage.tsx");
    expect(c, "було: тихий no-op, якщо чернетка не порожня").not.toMatch(/setDraft\(\(d\) => d \|\| t\("chats\.debtReminderDraft"\)\)/);
    expect(c).toMatch(/data-chat-composer="1"/);
    expect(c).toMatch(/el\?\.focus\(\)/);
  });

  it("«🔒 Доступно в Pro» — дія, а не напис", () => {
    const p = src("src/components/ProRulesCard.tsx");
    expect(p).toMatch(/onClick=\{\(\) => navigate\("\/subscription"\)\}/);
    expect(p, "текст-тупик").not.toMatch(/<span[^>]*>\s*<Lock className="h-3 w-3" \/> \{t\("proRulesCard\.availableInPro"\)\}/);
  });
});

describe("аудит шляхів 24.09: глухі кути й зайві переходи", () => {
  it("учень із заявкою в роботі не бачить другого запрошення подати заявку", () => {
    expect(src("src/pages/student/StudentDashboardPage.tsx"))
      .toMatch(/\{!hasTutor && !pendingTutorRequest && \(/);
  });

  it("перехід у Фінанси й у форму уроку — без перезавантаження застосунку", () => {
    expect(src("src/pages/DashboardPage.tsx")).not.toMatch(/window\.location\.href = "\/finances"/);
    expect(src("src/pages/DashboardPage.tsx")).toMatch(/navigate\("\/finances\?tab=debts"\)/);
    expect(src("src/pages/ChatsPage.tsx")).not.toMatch(/window\.location\.href = sid/);
  });

  it("порожній розклад під фільтрами каже правду і пропонує їх скинути", () => {
    const s = src("src/pages/SchedulePage.tsx");
    expect(s).toMatch(/\) : filtersActive \? \([\s\S]{0,500}schedule\.filteredEmptyTitle/);
    expect(s).toMatch(/onAction=\{\(\) => filters\.reset\(\)\}/);
  });

  it("сповіщення про урок приносить учня до САМОГО уроку", () => {
    expect(src("supabase/functions/lesson-reminders/index.ts"))
      .toMatch(/link: `\/student\/schedule\?lesson=\$\{lesson\.id\}`/);
    const page = src("src/pages/student/StudentSchedulePage.tsx");
    expect(page).toMatch(/searchParams\.get\("lesson"\)/);
    expect(page).toMatch(/data-lesson-id=\{l\.id\}/);
    expect(page).toMatch(/scrollIntoView/);
  });
});

describe("аудит шляхів 24.09: менше дотиків", () => {
  it("скасування уроку питає підтвердження ДО запису і сповіщення учневі", () => {
    const h = src("src/hooks/useLessonStatus.ts");
    const cancel = h.slice(h.indexOf("const cancel = async"), h.indexOf("const completeMany"));
    expect(cancel).toMatch(/confirmDialog\(\{[\s\S]{0,300}lessonCancelConfirm\.title/);
    expect(cancel.indexOf("confirmDialog(")).toBeLessThan(cancel.indexOf("setLessonStatus(l.id, \"cancelled\")"));
    expect(cancel).toMatch(/if \(!ok\) return false;/);
  });

  it("форма уроку знову підставляє звичний час пари", () => {
    const d = src("src/components/QuickLessonDialog.tsx");
    // Підказка вимикалась, щойно викликач передавав будь-яку дату.
    expect(d).toMatch(/const effStartsAt = whenLocal \?\? startsAt \?\? fallbackStart;/);
    expect(d).toMatch(/void pairNextDefault\(effTutorId, studentId\)/);
    expect(src("src/pages/DashboardPage.tsx"), "дашборд більше не підставляє «зараз»")
      .not.toMatch(/startsAt=\{quickLessonOpen \? new Date\(\) : null\}/);
    expect(src("src/pages/MyStudentsPage.tsx"))
      .not.toMatch(/startsAt=\{new Date\(Date\.now\(\) \+ 60 \* 60 \* 1000\)\}/);
  });

  it("форма оплати показує, скільки всього неоплачено", () => {
    expect(src("src/components/RecordPaymentSheet.tsx"))
      .toMatch(/recordPaymentExtra\.selectedTotal[\s\S]{0,300}pairUnpaid\.reduce/);
  });
});

describe("аудит шляхів 24.09: навігація під щоденні дії", () => {
  it("унизу — список людей, а не чати (рішення власниці 24.09)", () => {
    const n = src("src/components/MobileBottomNav.tsx");
    expect(n).toMatch(/const peopleTab = flags\.isManager\s*\n\s*\? \{ to: "\/people"/);
    // через canSee + готовність персони (гейти 01.09), а не сирий прапорець
    expect(n).toMatch(/roleReady && canSee\("ownStudents", flags\)\s*\n\s*\? \{ to: "\/my-students"/);
    expect(n, "хабовому списку учнів не належить — у нього лишаються чати").toMatch(/\{ to: "\/chats", icon: MessageSquare, labelKey: "nav\.chats" \}; \/\/ хабовий/);
    const tabs = n.slice(n.indexOf("const tabs = ["), n.indexOf("] as const;"));
    expect(tabs).toContain("peopleTab");
    expect(tabs).not.toMatch(/to: "\/chats"/);
  });

  it("непрочитані чати видно на бургері, бо вони пішли з нижньої панелі", () => {
    const l = src("src/components/AppLayout.tsx");
    expect(l).toMatch(/const unreadChats = useUnreadChats\(\);/);
    expect(l).toMatch(/\{unreadChats > 0 && \(/);
  });

  it("«Доступні години» і досягнення учня мають вхід у меню", () => {
    const side = src("src/components/AppSidebar.tsx");
    expect(side).toMatch(/\{ to: "\/availability", labelKey: "nav\.availability"/);
    expect(side).toMatch(/\{ to: "\/student\/achievements", labelKey: "nav\.achievements", icon: Trophy, roles: \["student"\] \}/);
  });
});
