import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eventsToStudents, calendarToImportText, splitTitle, type CalendarEvent } from "@/lib/calendarImport";
import { parseStudentList, type CanonicalWords } from "@/lib/importStudents";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const kw: CanonicalWords = {
  debt: "борг", prepay: "передоплата", lessons: "уроки", money: "грн", min: "хв", price: "по",
  day: (wd) => ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"][wd],
};
// Понеділок 2026-10-05, місцевий час (тест не залежить від зони: будуємо через Date)
const at = (dayOffset: number, h: number, m = 0, minutes = 60): { start: string; end: string } => {
  const d = new Date(2026, 9, 5 + dayOffset, h, m, 0, 0);
  const e = new Date(d.getTime() + minutes * 60000);
  return { start: d.toISOString(), end: e.toISOString() };
};
const ev = (id: string, summary: string, s: { start: string; end: string }, recurring = false): CalendarEvent => ({ id, summary, recurring, ...s });

describe("назва події → імʼя і предмет", () => {
  it("«Урок: Англійська — Марія (онлайн)» → Марія / Англійська", () => {
    expect(splitTitle("Урок: Англійська — Марія (онлайн)")).toEqual({ name: "Марія", subject: "Англійська" });
  });
  it("«Math with Olle Svensson» → Olle Svensson / Math", () => {
    expect(splitTitle("Math with Olle Svensson")).toEqual({ name: "Olle Svensson", subject: "Math" });
  });
  it("«Zoom» без імені → нічого", () => {
    expect(splitTitle("Zoom").name).toBe("");
  });
});

describe("події → учні з розкладом (лише те, що повторюється)", () => {
  const events: CalendarEvent[] = [
    ev("1", "Марія — англійська", at(0, 18), true),
    ev("2", "Марія — англійська", at(7, 18), true),
    ev("3", "Марія — англійська", at(3, 18), true),
    ev("4", "Іван Сидоренко математика", at(1, 17, 30, 90)),
    ev("5", "Іван Сидоренко математика", at(8, 17, 30, 90)),
    ev("6", "Стоматолог", at(2, 10)),
    ev("7", "Zoom", at(4, 12)),
  ];

  it("повторювана подія → учень зі слотами; та сама назва двічі → теж; разові — пропущено", () => {
    const imp = eventsToStudents(events);
    expect(imp.students.map((s) => s.name)).toEqual(["Іван Сидоренко", "Марія"]);
    const maria = imp.students[1];
    expect(maria.subject).toBe("англійська");
    expect(maria.slots).toEqual([{ weekday: 1, time: "18:00" }, { weekday: 4, time: "18:00" }]);
    expect(maria.durationMinutes).toBe(60);
    const ivan = imp.students[0];
    expect(ivan.slots).toEqual([{ weekday: 2, time: "17:30" }]);
    expect(ivan.durationMinutes).toBe(90);
    expect(imp.skipped).toEqual([{ title: "Zoom", reason: "no_name" }, { title: "Стоматолог", reason: "once" }]);
  });

  it("рядки імпорту читає той самий парсер — розклад і тривалість збігаються", () => {
    const text = calendarToImportText(eventsToStudents(events), kw);
    expect(text.split("\n")).toEqual([
      "Іван Сидоренко — математика — вт 17:30 — 90 хв",
      "Марія — англійська — пн 18:00, чт 18:00",
    ]);
    const rows = parseStudentList(text).filter((r) => !r.error);
    expect(rows).toHaveLength(2);
    expect(rows[0].firstName).toBe("Іван");
    expect(rows[0].schedule).toEqual([{ weekday: 2, time: "17:30" }]);
    expect(rows[0].durationMinutes).toBe(90);
    expect(rows[0].price).toBeNull(); // ціни в календарі немає — і ми її не вигадуємо
    expect(rows[1].schedule.map((s) => s.weekday)).toEqual([1, 4]);
  });
});

describe("edge google-calendar-import: лише читання, лише своє, з межами", () => {
  const s = () => noComments(read("supabase/functions/google-calendar-import/index.ts"));
  it("користувач лише свій; без токена — not_connected; 28 днів, 500 подій, 20/год", () => {
    const src = s();
    expect(src).toMatch(/if \(!user\) return json\(401, \{ error: "unauthorized" \}\);/);
    expect(src).toMatch(/if \(!token\) return json\(409, \{ error: "not_connected" \}\);/);
    expect(src).toMatch(/export const IMPORT_DAYS = 28;/);
    expect(src).toMatch(/export const MAX_EVENTS = 500;/);
    expect(src).toMatch(/rateLimit\(admin, "gcal_import", user\.id, PER_USER_HOUR, 3600\)/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.google-calendar-import\]\s*\n\s*verify_jwt = true/);
  });
  it("повертає лише назву й час — без описів, учасників і посилань", () => {
    const src = s();
    expect(src).toMatch(/summary: String\(e\.summary \?\? ""\)\.slice\(0, 120\)/);
    expect(src).not.toMatch(/attendees|description|hangoutLink/);
  });
});

describe("клієнт: календар — четверте джерело, той самий екран", () => {
  it("непідключений → кнопка підключення; підключений → читання; результат — рядки в полі", () => {
    const src = noComments(read("src/components/ImportStudentsSheet.tsx"));
    expect(src).toMatch(/supabase\.functions\.invoke\("google-calendar-import", \{ body: \{\} \}\)/);
    expect(src).toMatch(/if \(code === "not_connected"\) \{ setCalNotConnected\(true\); return; \}/);
    expect(src).toMatch(/setText\(calendarToImportText\(imp, kw\)\);/);
    expect(src).toMatch(/\["calendar", CalendarDays, t\("importStudents\.sourceCalendar"\)\]/);
    expect(src).toMatch(/importStudents\.calendarNothing/);
  });
});
