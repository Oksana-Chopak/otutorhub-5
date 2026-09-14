/**
 * 14.09 — власниця тестувала лендінг СВОЇМИ нотатками:
 *   тимур 2 передоплати · таня 500 грн борг · люся 350 · маргарита 200 ·
 *   математика на середу о 18:00 · українська у вівторок 10 ранку
 * і побачила «Уроків у списку поки немає — допишіть дні й час». Дні й час БУЛИ —
 * але «на середу» (знахідний), «у вівторок», «о 18:00», «10 ранку» парсер не
 * читав, а рядок без імені учня вважав помилкою.
 *
 * Тепер: дні тижня в усіх відмінках і з прийменниками, час у людських формах,
 * а рядок «предмет + день + час» без учня — це урок без учня: на лендінгу він
 * стоїть у дайджесті (підпис — предмет), в імпорті людина каже, чий він.
 */
import { describe, it, expect } from "vitest";
import { parseStudentLine, parseStudentList, toCanonicalText, type CanonicalWords } from "@/lib/importStudents";
import { digestPreview, calcMoneyPreview } from "@/lib/landingCalc";

const kw: CanonicalWords = {
  debt: "борг", prepay: "передоплата", lessons: "уроки", money: "грн", min: "хв",
  day: (wd) => ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"][wd],
};
const NOTES = "тимур 2 передоплати\nтаня 500 грн борг\nлюся 350\nмаргарита 200\nматематика на середу о 18:00\nукраїнська у вівторок 10 ранку";

describe("дні тижня й час — як у нотатках", () => {
  const cases: Array<[string, number, string]> = [
    ["Оля на середу о 18:00", 3, "18:00"],
    ["Оля у вівторок 10 ранку", 2, "10:00"],
    ["Оля в понеділок о 18", 1, "18:00"],
    ["Оля у пʼятницю 5 вечора", 5, "17:00"],
    ["Оля в суботу о 12 дня", 6, "12:00"],
    ["Оля щосуботи о 9 ранку", 6, "09:00"],
    ["Оля у неділю 3 дня", 7, "15:00"],
    ["Оля пн 18-00", 1, "18:00"],
    ["Оля пн 18.30", 1, "18:30"],
    ["Оля пн. 18:00", 1, "18:00"],
    ["Оля — пн о 18 год", 1, "18:00"],
    ["Оля — вт 18:00-19:00", 2, "18:00"],
    ["Оля — вт 18:00–19:30", 2, "18:00"],
    ["Kate — fri 7 pm", 5, "19:00"],
    ["Kate — mon at 10 am", 1, "10:00"],
  ];
  for (const [line, wd, time] of cases) {
    it(line, () => {
      const r = parseStudentLine(line, { mode: "debts" })!;
      expect(r.firstName).toMatch(/^(Оля|Kate)$/);
      expect(r.schedule).toEqual([{ weekday: wd, time }]);
      expect(r.note).toBeNull();
    });
  }
  it("«по вівторках і четвергах о 17» — два дні; «вт,чт 16:30» як і було", () => {
    expect(parseStudentLine("Ігор — англійська — по вівторках і четвергах о 17", { mode: "debts" })!.schedule)
      .toEqual([{ weekday: 2, time: "17:00" }, { weekday: 4, time: "17:00" }]);
    expect(parseStudentLine("Аня — вт,чт 16:30 — 400", { mode: "import" })!.schedule)
      .toEqual([{ weekday: 2, time: "16:30" }, { weekday: 4, time: "16:30" }]);
  });
  it("«Тарас 1200 (за 2 уроки)» і «Настя — вт 18:00 — 500» не зіпсувались", () => {
    const a = parseStudentLine("Тарас 1200 (за 2 уроки)", { mode: "debts" })!;
    expect(a.debtAmount).toBe(1200);
    const b = parseStudentLine("Настя — вт 18:00-19:00 — 500", { mode: "debts" })!;
    expect(b.debtAmount).toBe(500);
    expect(b.schedule).toEqual([{ weekday: 2, time: "18:00" }]);
  });
});

describe("урок без учня (scheduleOnly)", () => {
  it("«математика на середу о 18:00» — не помилка, а урок без учня з предметом", () => {
    const r = parseStudentLine("математика на середу о 18:00", { mode: "debts" })!;
    expect(r.error).toBeNull();
    expect(r.scheduleOnly).toBe(true);
    expect(r.firstName).toBe("");
    expect(r.subject).toBe("математика");
    expect(r.schedule).toEqual([{ weekday: 3, time: "18:00" }]);
  });
  it("рядок без імені й без розкладу — досі «не впізнав імʼя»", () => {
    expect(parseStudentLine("500 грн борг", { mode: "debts" })!.error).toBe("empty_name");
    expect(parseStudentLine("винна 500 грн", { mode: "debts" })!.error).toBe("empty_name");
    // одне службове слово + число = підпис колонки, як і раніше (пропускається)
    expect(parseStudentLine("борг 500", { mode: "debts" })).toBeNull();
  });
  it("нотатки власниці: гроші ті самі, у дайджесті зʼявляється урок, учнів — 4, уроків на місяць — 8", () => {
    const rows = parseStudentList(NOTES, { mode: "debts" });
    expect(rows.filter((r) => r.error)).toHaveLength(0);
    expect(rows.filter((r) => r.scheduleOnly)).toHaveLength(2);
    const calc = calcMoneyPreview(rows);
    expect(calc.students).toBe(4);
    expect(calc.owed).toBe(1050);
    expect(calc.lessonsPerMonth).toBe(8);
    expect(calc.monthly).toBe(0);
    // понеділок 14.09 → найближчий урок — вівторок 15.09, 10:00, підпис — предмет з великої
    const d = digestPreview(rows, new Date("2026-09-14T09:00:00+03:00"));
    expect(d.day).not.toBeNull();
    expect(d.day!.lessons).toEqual([{ time: "10:00", name: "Українська" }]);
    expect(d.debtors.map((x) => x.name)).toEqual(["таня", "люся", "маргарита"]);
  });
  it("канонічний текст естафети зберігає уроки без учня і читається імпортом однаково (round-trip)", () => {
    const rows = parseStudentList(NOTES, { mode: "debts" });
    const canon = toCanonicalText(rows, kw);
    expect(canon).toContain("математика — ср 18:00");
    expect(canon).toContain("українська — вт 10:00");
    const again = parseStudentList(canon, { mode: "import" });
    const so = again.filter((r) => r.scheduleOnly);
    expect(so.map((r) => [r.subject, r.schedule[0].weekday, r.schedule[0].time])).toEqual([["математика", 3, "18:00"], ["українська", 2, "10:00"]]);
    expect(again.find((r) => r.firstName === "таня")!.debtAmount).toBe(500);
    expect(again.find((r) => r.firstName === "тимур")!.prepayLessons).toBe(2);
  });
});
