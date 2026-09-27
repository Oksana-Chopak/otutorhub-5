import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daysSinceLastPayoutDay, isPayoutDueToday, type PayoutSchedule } from "@/lib/payoutSchedule";
import { rememberReturnTo, peekReturnTo, takeReturnTo } from "@/lib/returnTo";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const sched = (o: Partial<PayoutSchedule>): PayoutSchedule => ({
  payout_frequency: null, payout_weekday: null, payout_monthday: null, payout_anchor: null, ...o,
});
/* 2026: 21.09 — понеділок, 25.09 — пʼятниця, 27.09 — неділя. */
const d = (day: number, h = 10) => new Date(2026, 8, day, h);

describe("виплата не зникає разом із днем графіка (§4 аудиту)", () => {
  it("без графіка нічого не вигадуємо", () => {
    expect(daysSinceLastPayoutDay(sched({}), d(23))).toBeNull();
  });

  it("щотижня: у сам день 0, через три дні — 3", () => {
    const s = sched({ payout_frequency: "weekly", payout_weekday: 1 }); // понеділок
    expect(daysSinceLastPayoutDay(s, d(21))).toBe(0);
    expect(daysSinceLastPayoutDay(s, d(24))).toBe(3);
    expect(daysSinceLastPayoutDay(s, d(27))).toBe(6);
  });

  it("щомісяця: 1-го числа 0, 5-го — 4", () => {
    const s = sched({ payout_frequency: "monthly", payout_monthday: 1 });
    expect(daysSinceLastPayoutDay(s, d(1))).toBe(0);
    expect(daysSinceLastPayoutDay(s, d(5))).toBe(4);
  });

  it("раз на два тижні: рахує від того самого предиката, що й «сьогодні день виплати»", () => {
    const s = sched({ payout_frequency: "biweekly", payout_weekday: 1, payout_anchor: d(7).toISOString() });
    // сам день — нуль; далі відповідь МУСИТЬ показувати на день, у який
    // isPayoutDueToday справді true (другої математики графіка немає).
    expect(daysSinceLastPayoutDay(s, d(21))).toBe(0);
    const since = daysSinceLastPayoutDay(s, d(26))!;
    const back = new Date(d(26).getTime() - since * 86_400_000);
    expect(isPayoutDueToday(s, back)).toBe(true);
  });

  it("дашборд більше не ховає картку наступного дня — і підписує запізнення", () => {
    const dash = read("src/pages/DashboardPage.tsx");
    expect(dash, "стара умова існувала рівно один день")
      .not.toMatch(/if \(!isPayoutDueToday\(sch\)\) return;/);
    expect(dash).toMatch(/const daysLate = daysSinceLastPayoutDay\(sch\);/);
    expect(dash).toMatch(/daysLate === null\) return;/);
    expect(dash, "прострочена виплата має ІНШИЙ заголовок")
      .toMatch(/daysLate > 0\s*\n?\s*\? t\("dashboardExtra\.payoutOverdueTitle"/);
    expect(dash, "нічого платити — картки немає (скарга власниці 11.08)")
      .toMatch(/if \(unpaid\.length === 0\) return;/);
  });
});

describe("пакетна виплата на телефоні (§4 аудиту)", () => {
  const fin = () => read("src/pages/FinancesPage.tsx");

  it("у мобільній картці уроку є чекбокс, і це ТОЙ САМИЙ вибір, що в таблиці", () => {
    const f = fin();
    expect(f).toMatch(/const isSelectedMobile = selected\.has\(l\.id\);/);
    expect(f).toMatch(/onCheckedChange=\{\(\) => toggleRow\(l\.id\)\}/);
    // другої пакетної логіки не заводимо — лишається один bulkMark
    expect((f.match(/const bulkMark = async/g) ?? []).length).toBe(1);
  });

  it("панель дій більше не тільки для десктопа і не ховається за нижньою навігацією", () => {
    const f = fin();
    expect(f).not.toMatch(/sticky bottom-4 z-30 mt-4 hidden items-center gap-2/);
    expect(f).toMatch(/sticky bottom-\[86px\] z-30 mt-4 flex flex-wrap items-center/);
    expect(f, "на телефоні кнопки мусять бути 44px").toMatch(/flex h-11 items-center gap-1\.5 rounded-\[12px\] px-4/);
  });

  it("виплата репетиторам лишається недоступною самостійному — у нього немає виплат", () => {
    expect(fin()).toMatch(/\{!isIndependentTutor && \(\s*\n\s*<button[\s\S]{0,300}bulkMark\("tutor_payout_status"\)/);
  });
});

describe("повернення до перерваної дії (§4 аудиту)", () => {
  it("памʼятає лише ВНУТРІШНІЙ шлях: чужа адреса тут була б відкритим перенаправленням", () => {
    sessionStorage.clear();
    rememberReturnTo("https://evil.example/x");
    expect(peekReturnTo()).toBeNull();
    rememberReturnTo("//evil.example/x");
    expect(peekReturnTo()).toBeNull();
    rememberReturnTo("/finances?record=1");
    expect(peekReturnTo()).toBe("/finances?record=1");
  });

  it("повернення ОДНОРАЗОВЕ — інакше кнопка жила б вічно", () => {
    sessionStorage.clear();
    rememberReturnTo("/schedule?create=1");
    expect(takeReturnTo()).toBe("/schedule?create=1");
    expect(takeReturnTo()).toBeNull();
    expect(peekReturnTo()).toBeNull();
  });

  it("замок запамʼятовує шлях ДО переходу на підписку", () => {
    const lock = read("src/hooks/useCoreLock.tsx");
    expect(lock).toMatch(/rememberReturnTo\(location\.pathname \+ location\.search\);/);
    expect(lock).toMatch(/navigate\("\/subscription\?from=paywall"\);/);
  });

  it("кнопка «продовжити» зʼявляється ЛИШЕ коли підписка справді активна", () => {
    const sub = read("src/pages/SubscriptionPage.tsx");
    expect(sub).toMatch(/const returnTo = isActive \? peekReturnTo\(\) : null;/);
    expect(sub).toMatch(/const target = takeReturnTo\(\);/);
    expect(sub, "після повернення з LiqPay сторінка чекає вебхук, а не показує «Free»")
      .toMatch(/void waitForActive\(\);/);
  });
});

describe("одна форма створення учня (§4 аудиту)", () => {
  it("«Мої учні» відкривають канон, а власної копії створення не мають", () => {
    const ms = read("src/pages/MyStudentsPage.tsx");
    expect(ms).toMatch(/const openCreate = \(\) => setQuickAdd\(true\);/);
    expect(ms).toMatch(/<QuickAddStudentDialog\s*\n\s*open=\{quickAdd\}/);
    expect(ms, "гілки створення в обробнику більше немає").not.toMatch(/dialog\.mode/);
    expect(ms).not.toMatch(/add_or_link_independent_student/);
  });

  it("діп-лінк «?new=1» веде в ту саму форму", () => {
    expect(read("src/pages/MyStudentsPage.tsx"))
      .toMatch(/searchParams\.get\("new"\) === "1"[\s\S]{0,120}setQuickAdd\(true\);/);
  });
});
