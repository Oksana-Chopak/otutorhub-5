import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TimeZoneNote } from "@/components/TimeZoneNote";
import { offsetMinutes, wallInZone, wallToInstant, sameClock, timeInZone } from "@/lib/timeZone";
import { slotsForViewer, computeAvailableForDate, splitIntoSlots, type WeeklyRow, type BookedRow } from "@/lib/availability";

/* 14.11, рішення власниці «так, звісно виправ і те, що знайшла»: пояс кожної людини
   зберігається, і час кажуть кожному за ЙОГО годинником. */
describe("пояс іншої людини: арифметика (14.11)", () => {
  const nov = new Date("2026-11-16T13:00:00Z");     // понеділок
  const jul = new Date("2026-07-13T13:00:00Z");
  it("зсув: Київ 120 узимку й 180 улітку, Стокгольм 60 / 120, Торонто −300 / −240", () => {
    expect(offsetMinutes("Europe/Kyiv", nov)).toBe(120);
    expect(offsetMinutes("Europe/Kyiv", jul)).toBe(180);
    expect(offsetMinutes("Europe/Stockholm", nov)).toBe(60);
    expect(offsetMinutes("Europe/Stockholm", jul)).toBe(120);
    expect(offsetMinutes("America/Toronto", nov)).toBe(-300);
    expect(offsetMinutes("America/Toronto", jul)).toBe(-240);
    expect(offsetMinutes("No/Such_Zone", nov)).toBe(0);
  });
  it("15:00 у Стокгольмі — це 16:00 у Києві, 15:00 у Берліні, 09:00 у Торонто", () => {
    const at = wallToInstant("2026-11-16", 15 * 60, "Europe/Stockholm");
    expect(at.toISOString()).toBe("2026-11-16T14:00:00.000Z");
    expect(wallInZone(at, "Europe/Kyiv")).toMatchObject({ iso: "2026-11-16", minutes: 16 * 60, weekday: 1 });
    expect(wallInZone(at, "Europe/Berlin").minutes).toBe(15 * 60);
    expect(wallInZone(at, "America/Toronto").minutes).toBe(9 * 60);
    expect(sameClock("Europe/Stockholm", "Europe/Berlin", at)).toBe(true);
    expect(sameClock("Europe/Stockholm", "Europe/Kyiv", at)).toBe(false);
    expect(timeInZone(at, "Europe/Kyiv", "Europe/Stockholm", "uk")).toBe("16:00");
  });
  it("якщо в людини вже інший день — це видно: 23:30 у Києві = «пн 16:30» у Торонто… і навпаки", () => {
    const late = wallToInstant("2026-11-16", 23 * 60 + 30, "America/Toronto");   // пн 23:30 Торонто
    expect(wallInZone(late, "Europe/Kyiv").iso).toBe("2026-11-17");
    expect(timeInZone(late, "Europe/Kyiv", "America/Toronto", "uk")).toMatch(/^вт 06:30$/);
  });
  it("перехід на літній час: 10:00 у Києві 29 березня — це 07:00 UTC, а не 08:00", () => {
    expect(wallToInstant("2026-03-28", 10 * 60, "Europe/Kyiv").toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(wallToInstant("2026-03-29", 10 * 60, "Europe/Kyiv").toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });
});

describe("вільні години репетитора очима людини в іншому поясі (14.11)", () => {
  const weekly: WeeklyRow[] = [{ weekday: 1, start_minute: 10 * 60, end_minute: 14 * 60 } as WeeklyRow];   // пн 10–14 за Києвом
  const now = new Date("2026-11-15T12:00:00Z");
  it("Київ 10:00–14:00 менеджерка у Стокгольмі бачить як 09:00–13:00", () => {
    const r = slotsForViewer({ viewerDates: ["2026-11-16"], weekly, overrides: [], booked: [], tutorTz: "Europe/Kyiv", viewerTz: "Europe/Stockholm", slotMinutes: 60, now });
    expect(r["2026-11-16"].map((s) => s.start / 60)).toEqual([9, 10, 11, 12]);
  });
  it("урок о 11:00 за Києвом забирає саме слот 10:00 у Стокгольмі (раніше забирався не той)", () => {
    const booked: BookedRow[] = [{ starts_at: "2026-11-16T09:00:00.000Z", duration_minutes: 60 }];        // 11:00 Київ
    const r = slotsForViewer({ viewerDates: ["2026-11-16"], weekly, overrides: [], booked, tutorTz: "Europe/Kyiv", viewerTz: "Europe/Stockholm", slotMinutes: 60, now });
    expect(r["2026-11-16"].map((s) => s.start / 60)).toEqual([9, 11, 12]);
  });
  it("слот, що перейшов через північ, потрапляє в сусідній день глядача (Київ → Торонто)", () => {
    const early: WeeklyRow[] = [{ weekday: 2, start_minute: 5 * 60, end_minute: 7 * 60 } as WeeklyRow];     // вт 05–07 Київ = пн 22–24 Торонто
    const r = slotsForViewer({ viewerDates: ["2026-11-16", "2026-11-17"], weekly: early, overrides: [], booked: [], tutorTz: "Europe/Kyiv", viewerTz: "America/Toronto", slotMinutes: 60, now });
    expect(r["2026-11-16"].map((s) => s.start / 60)).toEqual([22, 23]);
    expect(r["2026-11-17"]).toEqual([]);
  });
  it("минулі слоти не показуються; той самий пояс дає те саме, що й старий шлях", () => {
    const r = slotsForViewer({ viewerDates: ["2026-11-16"], weekly, overrides: [], booked: [], tutorTz: "Europe/Kyiv", viewerTz: "Europe/Kyiv", slotMinutes: 60, now: new Date("2026-11-16T09:30:00Z") });
    expect(r["2026-11-16"].map((s) => s.start / 60)).toEqual([12, 13]);                                     // 11:30 Київ уже минуло 10 і 11
    const same = slotsForViewer({ viewerDates: ["2026-11-16"], weekly, overrides: [], booked: [], tutorTz: "Europe/Kyiv", viewerTz: "Europe/Kyiv", slotMinutes: 60, now });
    const old = splitIntoSlots(computeAvailableForDate(new Date(2026, 10, 16, 12), weekly, [], []), 60);
    expect(same["2026-11-16"]).toEqual(old);
  });
});

describe("позначка називає час ІНШОЇ людини поіменно (14.11)", () => {
  // пристрій «стоїть» у Стокгольмі, хоч де біжить тест
  beforeEach(() => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: "Europe/Stockholm" };
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  const mount = async (people: Array<{ name: string; tz?: string | null }>, extra: Record<string, unknown> = {}) =>
    render(<TimeZoneNote at="2026-11-16T14:00:00.000Z" others people={people} {...extra} />);
  it("репетиторка в Києві — «16:00 · Київ (GMT+2)»; учень у Берліні має той самий час — про нього мовчимо", async () => {
    await mount([{ name: "Ірина Коваль", tz: "Europe/Kyiv" }, { name: "Соломія Гнатюк", tz: "Europe/Berlin" }]);
    expect(screen.getByText(/За твоїм часом: Стокгольм \(GMT\+1\)/)).toBeTruthy();
    expect(screen.getByText("Ірина Коваль: 16:00 · Київ (GMT+2)")).toBeTruthy();
    expect(screen.queryByText(/Соломія Гнатюк:/)).toBeNull();
    // усі пояси відомі → загального «кожен побачить за своїм часом» немає
    expect(screen.queryByText(/Кожен учасник побачить/)).toBeNull();
  });
  it("чийсь пояс невідомий — не вгадуємо: лишається загальне речення", async () => {
    await mount([{ name: "Ірина Коваль", tz: "Europe/Kyiv" }, { name: "Марко Бойко", tz: null }]);
    expect(screen.getByText("Ірина Коваль: 16:00 · Київ (GMT+2)")).toBeTruthy();
    expect(screen.getByText(/Кожен учасник побачить урок за своїм місцевим часом/)).toBeTruthy();
    expect(screen.queryByText(/Марко Бойко:/)).toBeNull();
  });
  it("група: учасники одного поясу — одним рядком", async () => {
    await mount([{ name: "Оля", tz: "Europe/Kyiv" }, { name: "Петро", tz: "Europe/Kyiv" }, { name: "Ніна", tz: "Europe/Kyiv" }]);
    expect(screen.getByText("Оля, Петро +1: 16:00 · Київ (GMT+2)")).toBeTruthy();
  });
  it("деталі уроку: якщо в усіх той самий час — позначки немає взагалі", async () => {
    const { container } = await mount([{ name: "Соломія", tz: "Europe/Berlin" }], { onlyIfDiffers: true });
    expect(container.querySelector("[data-tz-note]")).toBeNull();
  });
});

describe("пояс зберігається й доходить до всіх поверхонь (14.11)", () => {
  const rd = (f: string) => readFileSync(f, "utf8");
  it("застосунок записує пояс пристрою при вході; читає чужі — лише через RPC під RLS", () => {
    expect(rd("src/components/AppLayout.tsx")).toMatch(/syncMyTimeZone\(user\.id\)/);
    const hook = rd("src/hooks/useTimeZones.ts");
    expect(hook).toMatch(/rpc\("set_my_timezone"/);
    expect(hook).toMatch(/rpc\("people_timezones"/);
    const sql = rd("supabase/migrations/20261114120000_person_timezone.sql");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS timezone text/);
    expect(sql).toMatch(/people_timezones\(_ids uuid\[\]\)[\s\S]*SECURITY INVOKER/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.people_timezones\(uuid\[\]\) FROM PUBLIC, anon/);
  });
  it("форма уроку, деталі уроку, копія, група, обидва запити на інший час передають людей у позначку", () => {
    expect(rd("src/components/QuickLessonDialog.tsx")).toMatch(/<TimeZoneNote at=\{`\$\{ymd\}T\$\{hm\}`\} others people=\{zonePeople\} tone="onDark"/);
    expect(rd("src/components/LessonDetailsDialog.tsx")).toMatch(/people=\{zonePeople\} onlyIfDiffers/);
    expect(rd("src/pages/SchedulePage.tsx")).toMatch(/zonePeople=\{copyZonePeople\}/);
    expect(rd("src/pages/GroupsPage.tsx")).toMatch(/<TimeZoneNote at=\{schedStart\} others people=\{zonePeople\}/);
    expect(rd("src/components/StudentLessonActions.tsx")).toMatch(/zonePeople=\{\[\{ name: t\("roles\.tutor"\), tz: zones\[tutorId\] \}\]\}/);
    expect(rd("src/components/TutorChangeRequestsCard.tsx")).toMatch(/zonePeople=\{active \? \[\{ name: nameOf\(active\.student_id\)/);
  });
  it("вільні години репетитора для людини в іншому поясі перераховуються", () => {
    const v = rd("src/components/TutorAvailabilityView.tsx");
    expect(v).toMatch(/slotsForViewer\(\{/);
    expect(v).toMatch(/timeZone\.convertedFrom/);
  });
});
