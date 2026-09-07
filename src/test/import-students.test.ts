import { describe, it, expect } from "vitest";
import { parseStudentList, parseStudentLine } from "@/lib/importStudents";

/**
 * Імпорт списку учнів (05.09): парсер детермінований — кожен формат із
 * підказки в UI має розбиратися рівно так, як обіцяє превʼю.
 */
describe("importStudents parser", () => {
  it("розбирає канонічний рядок «Імʼя Прізвище — предмет — ціна»", () => {
    const r = parseStudentLine("Марія Коваль — математика — 500")!;
    expect(r.firstName).toBe("Марія");
    expect(r.lastName).toBe("Коваль");
    expect(r.subject).toBe("математика");
    expect(r.price).toBe(500);
    expect(r.error).toBeNull();
  });

  it("роздільники кома/крапка з комою/таб/дефіс із пробілами — еквівалентні", () => {
    for (const line of [
      "Іван, англійська, 400",
      "Іван; англійська; 400",
      "Іван\tанглійська\t400",
      "Іван - англійська - 400",
    ]) {
      const r = parseStudentLine(line)!;
      expect(r.firstName).toBe("Іван");
      expect(r.subject).toBe("англійська");
      expect(r.price).toBe(400);
    }
  });

  it("«грн» і «₴» біля ціни зрізаються", () => {
    expect(parseStudentLine("Оля — хімія — 350 грн")!.price).toBe(350);
    expect(parseStudentLine("Оля — хімія — 350₴")!.price).toBe(350);
  });

  it("без роздільників: хвостове число = ціна, решта = імʼя", () => {
    const r = parseStudentLine("Марк Іваненко 600")!;
    expect(r.firstName).toBe("Марк");
    expect(r.lastName).toBe("Іваненко");
    expect(r.subject).toBeNull();
    expect(r.price).toBe(600);
  });

  it("лише імʼя — валідний рядок без предмета і ціни", () => {
    const r = parseStudentLine("Соломія")!;
    expect(r.firstName).toBe("Соломія");
    expect(r.subject).toBeNull();
    expect(r.price).toBeNull();
    expect(r.error).toBeNull();
  });

  it("нумерація списку зрізається, порожні рядки і заголовки пропускаються", () => {
    const rows = parseStudentList("Імʼя Предмет Ціна\n\n1. Марія — математика — 500\n2) Іван — фізика — 450\n");
    expect(rows).toHaveLength(2);
    expect(rows[0].firstName).toBe("Марія");
    expect(rows[1].firstName).toBe("Іван");
  });

  it("предмет без ціни та ціна без предмета не плутаються місцями", () => {
    const a = parseStudentLine("Петро — фізика")!;
    expect(a.subject).toBe("фізика");
    expect(a.price).toBeNull();
    const b = parseStudentLine("Оля Петренко, 350")!;
    expect(b.subject).toBeNull();
    expect(b.price).toBe(350);
    expect(b.lastName).toBe("Петренко");
  });

  it("нульова/відʼємна ціна не проходить як ціна", () => {
    expect(parseStudentLine("Ірина — біологія — 0")!.price).toBeNull();
  });
});

/**
 * 07.09 — «усе, що є»: хвости рядка (борг, передоплата, розклад, контакти),
 * таблиця з заголовками, нетто борг/передоплата, дати уроків на 4 тижні.
 */
import { netDebtAndPrepay, scheduleToStarts } from "@/lib/importStudents";

describe("importStudents · хвости 07.09", () => {
  it("борг сумою, передоплата уроками, розклад із двома днями через кому", () => {
    const r = parseStudentLine("Марія Коваль — англійська — 600 — борг 1200 — вт,чт 16:30")!;
    expect(r.price).toBe(600);
    expect(r.debtAmount).toBe(1200);
    expect(r.schedule).toEqual([{ weekday: 2, time: "16:30" }, { weekday: 4, time: "16:30" }]);
    expect(r.warnings).toEqual([]);
  });

  it("«борг 2 уроки» → уроками; «передоплата 3» → уроки; «передоплата 1500 ₴» → гроші", () => {
    expect(parseStudentLine("Іван — 500 — борг 2 уроки")!.debtLessons).toBe(2);
    expect(parseStudentLine("Іван — 500 — передоплата 3")!.prepayLessons).toBe(3);
    expect(parseStudentLine("Іван — 500 — передоплата 1500 ₴")!.prepayAmount).toBe(1500);
    expect(parseStudentLine("Іван — 500 — передоплата 1500")!.prepayAmount).toBe(1500);
  });

  it("розклад: «пн і ср о 17», «щопн 18:00», «mon 17.30»; час без дня — не розклад", () => {
    expect(parseStudentLine("Оля — пн і ср о 17")!.schedule).toEqual([{ weekday: 1, time: "17:00" }, { weekday: 3, time: "17:00" }]);
    expect(parseStudentLine("Оля — щопн 18:00")!.schedule).toEqual([{ weekday: 1, time: "18:00" }]);
    expect(parseStudentLine("Оля — mon 17.30")!.schedule).toEqual([{ weekday: 1, time: "17:30" }]);
    const r = parseStudentLine("Оля — англійська — 18:00")!;
    expect(r.schedule).toEqual([]);
    expect(r.subject).toBe("англійська");
  });

  it("контакти: телефон, пошта, telegram; нерозпізнане — в нотатку; тривалість", () => {
    const r = parseStudentLine("Оля — 350 — +38 (067) 123-45-67 — Mama@Gmail.com — @olya_mom — мама платить 1 числа — 90 хв")!;
    expect(r.phone).toBe("+380671234567");
    expect(r.email).toBe("mama@gmail.com");
    expect(r.telegram).toBe("@olya_mom");
    expect(r.note).toBe("мама платить 1 числа");
    expect(r.durationMinutes).toBe(90);
    expect(r.subject).toBeNull();
  });

  it("попередження: борг без ставки; «борг N уроків» без ставки; борг+передоплата; розклад без ціни", () => {
    expect(parseStudentLine("А — борг 1200")!.warnings).toEqual(["debt_without_price"]);
    expect(parseStudentLine("А — борг 2 уроки")!.warnings).toEqual(["debt_lessons_need_price"]);
    expect(parseStudentLine("А — 500 — борг 1000 — передоплата 2")!.warnings).toEqual(["prepay_covers_debt"]);
    expect(parseStudentLine("А — пн 18:00")!.warnings).toEqual(["schedule_without_price"]);
  });

  it("таблиця з Excel (таб + заголовки в будь-якому порядку) читається як рядки", () => {
    const text = [
      "Предмет\tІмʼя\tЦіна\tБорг\tДень\tЧас\tТелефон",
      "математика\tМарія Коваль\t500\t1000\tпн\t18:00\t+380501112233",
      "англійська\tІван\t400\t\tвт, чт\t16:30\t",
    ].join("\n");
    const rows = parseStudentList(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ firstName: "Марія", lastName: "Коваль", subject: "математика", price: 500, debtAmount: 1000, phone: "+380501112233" });
    expect(rows[0].schedule).toEqual([{ weekday: 1, time: "18:00" }]);
    expect(rows[1].schedule).toEqual([{ weekday: 2, time: "16:30" }, { weekday: 4, time: "16:30" }]);
    expect(rows[1].debtAmount).toBeNull();
  });

  it("нетто: борг 1000 і передоплата 2 уроки при ставці 500 → борг 0, передоплата 0; без ставки — як є", () => {
    const a = netDebtAndPrepay(parseStudentLine("А — 500 — борг 1000 — передоплата 2")!);
    expect(a).toEqual({ debtAmount: 0, debtLessons: 0, prepayLessons: 0, prepayAmount: 0 });
    const b = netDebtAndPrepay(parseStudentLine("Б — 500 — борг 1200 — передоплата 1")!);
    expect(b).toEqual({ debtAmount: 700, debtLessons: 0, prepayLessons: 0, prepayAmount: 0 });
    const c = netDebtAndPrepay(parseStudentLine("В — 500 — борг 400 — передоплата 2")!);
    expect(c).toEqual({ debtAmount: 0, debtLessons: 0, prepayLessons: 0, prepayAmount: 600 });
    const d = netDebtAndPrepay(parseStudentLine("Г — борг 1200 — передоплата 2")!);
    expect(d).toEqual({ debtAmount: 1200, debtLessons: 0, prepayLessons: 2, prepayAmount: 0 });
  });

  it("дати уроків: 4 тижні від найближчого входження, локальний час, відсортовано", () => {
    const now = new Date(2026, 8, 7, 12, 0); // понеділок 07.09.2026 12:00
    const starts = scheduleToStarts([{ weekday: 1, time: "18:00" }, { weekday: 4, time: "16:30" }], 4, now);
    expect(starts).toHaveLength(8);
    expect(starts[0].getDay()).toBe(1);
    expect(starts[0].getDate()).toBe(7); // сьогодні о 18:00 — ще попереду
    expect(starts[0].getHours()).toBe(18);
    expect(starts[1].getDay()).toBe(4);
    expect(starts[1].getHours()).toBe(16);
    expect(starts[1].getMinutes()).toBe(30);
    // «сьогодні, але вже минуло» → через тиждень
    const late = scheduleToStarts([{ weekday: 1, time: "10:00" }], 1, now);
    expect(late[0].getDate()).toBe(14);
  });
});
