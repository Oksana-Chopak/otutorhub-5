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
