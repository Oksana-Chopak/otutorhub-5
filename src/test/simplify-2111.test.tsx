/**
 * 21.11 — п'ять рішень власниці («1–5 так») після проходу 15.11 по всіх ролях:
 * мінімум вікон і виборів, застосунок веде сам. Кожне рішення тримається тут, щоб не
 * повернулось тихо. Живий прохід у браузері — `scripts/local-stack/school-walk.mjs`, крок 9;
 * база — сценарій `83-school-payment-details.sql`.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

describe("1. менеджер: одна форма «Новий учень» (було 4 вікна, 13 дотиків)", () => {
  it("поля пари — ОДИН компонент і в формі пари, і в «Новий учень»", () => {
    const people = read("src/pages/PeoplePage.tsx");
    expect(people).toMatch(/<PairFields\s+idPrefix="add-tutor"/);
    expect(people).toMatch(/<PairFields\s+idPrefix="new-student"/);
    expect((people.match(/<PairFields\b/g) ?? []).length).toBe(2);
    // другої копії вибору репетитора / ціни в «Людях» немає
    expect(people).not.toMatch(/id="add-tutor-price"/);
  });

  it("пару перевіряємо ДО створення людини — не лишається «учень є, пари немає» через порожню ціну", () => {
    const people = code(read("src/pages/PeoplePage.tsx"));
    const validate = people.indexOf("toast.error(t(\"people.enterValidPrice\"));\n      return;\n    }\n\n    setAdding(true);");
    const insert = people.indexOf(".from(\"profiles\")\n      .insert({ id: newId");
    expect(validate).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(validate);
  });

  it("репетитор, якого обрав застосунок, без ціни — не тупик: учень додається, далі «призначити» з ним же", () => {
    const people = read("src/pages/PeoplePage.tsx");
    expect(people).toMatch(/const pairWanted = pairChosen && \(pairTouchedRef\.current \|\| addForm\.pair\.price\.trim\(\) !== ""\);/);
    expect(people).toMatch(/pairDraft: pair && pairOk === false \? pair : pairDraftOnly/);
    expect(people, "«Далі: призначити» відкриває форму пари з тими ж значеннями").toMatch(/const draft = invite\.pairDraft \?\? EMPTY_PAIR;/);
  });

  it("пара пишеться тим самим записом, що й форма пари; галочка «одразу урок» веде у форму уроку з обома", () => {
    const people = read("src/pages/PeoplePage.tsx");
    expect(people).toMatch(/from\("student_rates"\)\.upsert\(\s*\{\s*tutor_id: pair\.tutorId,\s*student_id: newId/);
    expect(people).toMatch(/`\/schedule\?create=1&student=\$\{newId\}&tutor=\$\{pair\.tutorId\}`/);
    expect(people, "лист уже пішов і урок хочуть — без проміжного вікна").toMatch(/if \(role === "student" && wantLesson && emailSent && lessonHref\)/);
    expect(read("src/components/InviteLinkDialog.tsx"), "інакше місток у запрошенні несе й репетитора")
      .toMatch(/\$\{lessonTutorId \? `&tutor=\$\{lessonTutorId\}` : ""\}/);
  });

  it("застосунок обирає сам лише там, де вибору немає; ціну — ніколи (маржа школи)", async () => {
    const { PairFields, availablePairSubjects } = await import("@/components/PairFields");
    const tutors = [
      { id: "t1", name: "Ірина Коваль", subjects: ["Іспанська мова"] },
      { id: "t2", name: "Петро Городній", subjects: ["Математика", "Фізика"] },
    ];
    expect(availablePairSubjects(tutors[1], [], new Set(["Фізика"]))).toEqual(["Математика"]);
    expect(availablePairSubjects({ id: "x", name: "", subjects: [] }, ["А", "Б"], new Set())).toEqual(["А", "Б"]);
    const onChange = vi.fn();
    render(<PairFields idPrefix="t" tutors={tutors} fallbackSubjects={[]} tutorRate={() => 300}
      value={{ tutorId: "", subject: "", price: "", currency: "UAH" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Репетитор/), { target: { value: "t1" } });
    expect(onChange).toHaveBeenLastCalledWith({ tutorId: "t1", subject: "Іспанська мова", price: "", currency: "UAH" });
    fireEvent.change(screen.getByLabelText(/Репетитор/), { target: { value: "t2" } });
    expect(onChange).toHaveBeenLastCalledWith({ tutorId: "t2", subject: "", price: "", currency: "UAH" });
  });

  it("у школі один репетитор — він обраний сам; заявка називає предмет — репетитор цього предмета", () => {
    const people = read("src/pages/PeoplePage.tsx");
    expect(people).toMatch(/if \(!pick && pairTutors\.length === 1\)/);
    expect(people).toMatch(/leadSubjectRef\.current = \(searchParams\.get\("subject"\)/);
    expect(read("src/pages/DashboardPage.tsx"), "заявка з «Мого дня» несе предмет у форму").toMatch(/if \(l\.subject\) q\.set\("subject", l\.subject\);/);
  });

  it("форма уроку показує учня, з яким прийшли, першим у списку", () => {
    expect(read("src/components/QuickLessonDialog.tsx"))
      .toMatch(/\[\.\.\.rows\.filter\(\(r\) => r\.student_id === initialStudentId\), \.\.\.rows\.filter\(\(r\) => r\.student_id !== initialStudentId\)\]/);
  });
});

describe("2. менеджер: ставка — у потоці нового репетитора", () => {
  it("після «Додати» нового репетитора відкривається ЄДИНА форма ставки, запрошення — після неї", () => {
    const people = read("src/pages/PeoplePage.tsx");
    expect(people).toMatch(/if \(role === "tutor"\) \{\s*inviteAfterRateRef\.current = showInvite;\s*setTutorRate\(\{ open: true, tutorId: newId, subject: null \}\);/);
    expect(people, "запрошення показується й тоді, коли форму ставки закрили без запису")
      .toMatch(/if \(!o && inviteAfterRateRef\.current\) \{/);
    // друга копія форми ставки неможлива (стереже і tutor-rate-action.test.tsx)
    expect((people.match(/<TutorRateDialog\b/g) ?? []).length).toBe(1);
  });
});

describe("3. «Мій день» менеджера починається з грошей і людей", () => {
  it("порядок: борг → учень без репетитора → нова заявка; про нагадане за 3 доби борг — не головна дія", async () => {
    const { pickManagerFocus, remindedWithin } = await import("@/lib/managerFocus");
    const tasks = [
      { key: "no-meeting" },
      { key: "tutor-referral-requests" },
      { key: "school-lead-1" },
      { key: "students-no-tutor" },
      { key: "debtor-t:s1", remindPair: { studentId: "s1", tutorId: "t" } },
      { key: "debtor-t:s2", remindPair: { studentId: "s2", tutorId: "t" } },
    ];
    expect(pickManagerFocus(tasks, () => false)?.key).toBe("debtor-t:s1");
    expect(pickManagerFocus(tasks, (p) => p.studentId === "s1")?.key).toBe("debtor-t:s2");
    expect(pickManagerFocus(tasks, () => true)?.key).toBe("students-no-tutor");
    expect(pickManagerFocus(tasks.filter((t) => !t.key.startsWith("students")), () => true)?.key).toBe("school-lead-1");
    expect(pickManagerFocus([{ key: "no-meeting" }], () => false)).toBeNull();
    const now = Date.parse("2026-11-21T12:00:00Z");
    expect(remindedWithin("2026-11-20T12:00:00Z", now)).toBe(true);
    expect(remindedWithin("2026-11-17T12:00:00Z", now)).toBe(false);
    expect(remindedWithin(null, now)).toBe(false);
  });

  it("зверху — заявки «я оплатив», без них — одна справа; у списку нижче вона не повторюється", () => {
    const d = read("src/pages/DashboardPage.tsx");
    const claims = d.indexOf("{isManager && <PaymentClaimsCard onCount={setClaimsCount} />}");
    const focus = d.indexOf("{isManager && claimsCount === 0 && managerFocus && (");
    expect(claims).toBeGreaterThan(0);
    expect(focus).toBeGreaterThan(claims);
    expect(focus).toBeLessThan(d.indexOf("<DayBlock"));
    expect(d).toMatch(/smartTasks\.filter\(\(tk\) => tk\.key !== managerFocus\?\.key \|\| claimsCount > 0\)\.map\(renderSmartTaskCard\)/);
    expect(d, "одна дія: учень без репетитора → одразу форма пари").toMatch(/`\/people\?assign=\$\{firstStudentWithoutTutor\}`/);
  });

  it("🔒 нотатки менеджера лишились ОДРАЗУ під бульбашками", () => {
    const d = read("src/pages/DashboardPage.tsx");
    expect(d).toMatch(/\{\/\* Notes — ALWAYS directly under the bubbles, nowhere else \(manager\)\. \*\/\}[\s\S]{0,200}\{isManager && \(\s*<div className="mt-4 space-y-3">\s*<TutorNotesCard \/>/);
  });
});

describe("4. учень: один розклад", () => {
  it("загальний розклад веде учня в його власний з тими самими параметрами", () => {
    const s = read("src/pages/SchedulePage.tsx");
    expect(s).toMatch(/if \(!isPureStudent\) return;\s*navigate\(`\/student\/schedule\$\{window\.location\.search\}`, \{ replace: true \}\);/);
    expect(s, "інакше setSearchParams перебив би перехід").toMatch(/if \(isPureStudent\) return;\s*const v = searchParams\.get\("view"\);/);
  });

  it("«Попросити урок» — у розкладі учня; вільна година відкриває аркуш із цим часом", () => {
    const st = read("src/pages/student/StudentSchedulePage.tsx");
    expect(st).toMatch(/<TutorAvailabilityView key=\{tu\.id\}[\s\S]{0,120}onPickSlot=/);
    expect(st).toMatch(/<AskLessonSheet/);
    expect(st, "репетитори — і з пар, не лише з уроків").toMatch(/from\(await pairsRel\(\)\)\.select\("tutor_id"\)\.eq\("student_id", user\.id\)/);
    expect(read("src/components/TutorAvailabilityView.tsx"), "година — кнопка 44px").toMatch(/className="min-h-\[44px\]/);
  });

  it("прохання — сповіщення репетитору з часом і поясом автора; посилання відкриває форму уроку", async () => {
    const { askLessonLink } = await import("@/components/AskLessonSheet");
    const { isSafeInternalPath } = await import("@/lib/safePath");
    const link = askLessonLink("7fa1e14c-496d-4a61-ae9e-b908e9ea6391", new Date("2026-11-22T17:00:00.000Z"));
    expect(link).toBe("/schedule?create=1&student=7fa1e14c-496d-4a61-ae9e-b908e9ea6391&at=2026-11-22T17%3A00%3A00Z");
    expect(isSafeInternalPath(link)).toBe(true);
    const sheet = read("src/components/AskLessonSheet.tsx");
    expect(sheet).toMatch(/\+ zoneSuffix\(at\)/);
    expect(sheet, "друге прохання за день не ковтається дедупом").toMatch(/_type: `lesson_ask_\$\{crypto\.randomUUID\(\)\}`/);
    expect(sheet).toMatch(/if \(at\.getTime\(\) <= Date\.now\(\)\) \{ toast\.error\(t\("askLesson\.inPast"\)\)/);
    const sched = read("src/pages/SchedulePage.tsx");
    expect(sched, "форма уроку бере обраний учнем час").toMatch(/const at = searchParams\.get\("at"\);[\s\S]{0,300}asked\.getTime\(\) > Date\.now\(\)/);
  });
});

describe("знайдено роботом 21.11", () => {
  it("тост «урок проведено» без «+10 XP» і серій, поки гейміфікація вимкнена", () => {
    const h = read("src/hooks/useLessonStatus.ts");
    expect(h).toMatch(/GAMIFICATION_VISIBLE \? t\("dashboardExtra\.lessonCompletedToast"\) : t\("dashboardExtra\.lessonCompletedPlain"\)/);
    expect(h).toMatch(/o\.streakCount && GAMIFICATION_VISIBLE/);
  });
});

describe("5. школа: реквізити для оплати", () => {
  it("менеджер — у профілі; учень — у «Оплатах» з назвою школи; батьки — на сторінці оплати", () => {
    expect(read("src/pages/ProfilePage.tsx")).toMatch(/<SchoolPaymentCard \/>/);
    expect(read("src/components/SchoolPaymentCard.tsx")).toMatch(/\("set_my_hub_payment_details", \{ _details: value \}\)/);
    const pay = read("src/pages/student/StudentPaymentsPage.tsx");
    expect(pay).toMatch(/\("my_school_payment_details"\)/);
    expect(pay, "реквізити пари важливіші за реквізити школи").toMatch(/payment_details: own \?\? school\?\.details \?\? null/);
    expect(read("src/pages/PayLinkPage.tsx")).toMatch(/t\("payLink\.paySchool", \{ school: view\.school_name \}\)/);
    expect(read("src/components/RemindSheet.tsx"), "підказка веде в профіль школи, не в картку учня")
      .toMatch(/issue\.school \? "payLink\.noRequisitesSchool" : "payLink\.noRequisites"/);
  });

  it("база: пише лише менеджер своєї школи; учень бачить лише школи своїх репетиторів; публічна сторінка — без реквізитів", () => {
    const m = read("supabase/migrations/20261121120000_school_payment_details.sql");
    expect(m).toMatch(/-- LIVE-MARKER: my_school_payment_details/);
    const setFn = m.slice(m.indexOf("FUNCTION public.set_my_hub_payment_details"), m.indexOf("FUNCTION public.my_school_payment_details"));
    expect(setFn).toMatch(/has_role\(auth\.uid\(\), 'manager'::app_role\)/);
    expect(setFn).toMatch(/_hub := public\.caller_hub_id\(\);/);
    expect(setFn).toMatch(/UPDATE public\.hubs SET payment_details = _v WHERE id = _hub;/);
    const stu = m.slice(m.indexOf("FUNCTION public.my_school_payment_details"), m.indexOf("FUNCTION public.payment_link_view"));
    expect(stu).toMatch(/r\.student_id = auth\.uid\(\)/);
    expect(stu).toMatch(/lp\.student_id = auth\.uid\(\)/);
    expect(m).not.toMatch(/FUNCTION public\.hub_public_page/);
    expect(m).toMatch(/hubs_payment_details_len[\s\S]{0,120}char_length\(payment_details\) <= 600/);
    expect(read("scripts/db-replay/scenarios/83-school-payment-details.sql")).toMatch(/ROLLBACK;\s*$/);
    expect(read("docs/PROD-DB-SYNC.md")).toMatch(/`20261121120000_school_payment_details`/);
  });
});
