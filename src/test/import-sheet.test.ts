import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStudentList, tableRows, toCanonicalText, type CanonicalWords } from "@/lib/importStudents";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * «Перенести все, що є» за пару кліків (29.09): Google Таблиця за посиланням
 * (CSV) або файл → той самий парсер → ті самі рядки імпорту → той самий екран
 * підтвердження. Тут — золоті таблиці, як їх реально ведуть репетитори.
 */

const kw: CanonicalWords = {
  debt: "борг", prepay: "передоплата", lessons: "уроки", money: "грн", min: "хв",
  day: (wd) => ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"][wd],
};

describe("CSV з Google Таблиці читається як таблиця", () => {
  const csv = [
    "Учень,Телефон,Ціна (грн),Борг,День,Час,Предмет",
    "Марія Коваль,+380671112233,600,1200,пн,18:00,англійська",
    '"Петренко, Оля",,350,,"вт, чт",16:30,',
    "Іван Сидоренко,+380501234567,500,2 уроки,,,математика",
  ].join("\n");

  it("розбиває лапки й коми всередині комірок", () => {
    const rows = tableRows(csv)!;
    expect(rows).not.toBeNull();
    expect(rows[2][0]).toBe("Петренко, Оля");
    expect(rows[2][4]).toBe("вт, чт");
  });

  it("імена, ціни, борги, дні й телефони — з колонок, не з вигадок", () => {
    const rows = parseStudentList(csv).filter((r) => !r.error);
    expect(rows.map((r) => `${r.firstName} ${r.lastName}`.trim())).toEqual(["Марія Коваль", "Оля Петренко", "Іван Сидоренко"]);
    expect(rows[0].price).toBe(600);
    expect(rows[0].debtAmount).toBe(1200);
    expect(rows[0].phone).toMatch(/380671112233/);
    expect(rows[0].schedule).toEqual([{ weekday: 1, time: "18:00" }]);
    expect(rows[0].subject?.toLowerCase()).toContain("англ");
    expect(rows[1].price).toBe(350);
    expect(rows[1].schedule.map((s) => s.weekday)).toEqual([2, 4]);
    expect(rows[2].debtLessons).toBe(2);
    expect(rows[2].price).toBe(500);
  });

  it("крапка з комою (Excel у європейських локалях) — теж таблиця", () => {
    const rows = parseStudentList("Name;Phone;Rate\nAnna Berg;+46701234567;450\nOlle Svensson;;400").filter((r) => !r.error);
    expect(rows.map((r) => r.firstName)).toEqual(["Anna", "Olle"]);
    expect(rows[1].price).toBe(400);
  });

  it("заголовки з дужками, множиною, «телефон мами» — впізнаються", () => {
    const rows = parseStudentList("Учні,Телефон мами,Вартість уроку,Заборгованість (грн)\nОлена Іванова,+380931112233,450,900").filter((r) => !r.error);
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(450);
    expect(rows[0].debtAmount).toBe(900);
    expect(rows[0].phone).toMatch(/380931112233/);
  });

  it("вільний текст із комами таблицею НЕ вважається", () => {
    expect(tableRows("Марія, борг 500\nІван, 600, пн 18:00")).toBeNull();
    const rows = parseStudentList("Марія — 500, борг 1200\nІван — 600").filter((r) => !r.error);
    expect(rows).toHaveLength(2);
  });

  it("таблиця → канонічні рядки, які людина бачить і може поправити", () => {
    const canonical = toCanonicalText(parseStudentList(csv), kw);
    expect(canonical.split("\n")).toHaveLength(3);
    expect(canonical).toMatch(/^Марія Коваль — .*600.*борг 1200.*пн 18:00/m);
    // канон читається так само, як таблиця: числа не змінюються
    const again = parseStudentList(canonical).filter((r) => !r.error);
    expect(again[0].price).toBe(600);
    expect(again[0].debtAmount).toBe(1200);
    expect(again[2].debtLessons).toBe(2);
  });
});

describe("edge import-sheet-fetch: лише Google, без прав, з межами", () => {
  const s = () => noComments(read("supabase/functions/import-sheet-fetch/index.ts"));

  it("читає лише docs.google.com по https (жодних довільних адрес — SSRF)", () => {
    const src = s();
    expect(src).toMatch(/if \(u\.protocol !== "https:" \|\| u\.hostname !== "docs\.google\.com"\) return null;/);
    expect(src).toMatch(/\/\^\\\/spreadsheets\\\/d\\\/\(\[A-Za-z0-9_-\]\{10,\}\)\//);
  });

  it("приватна таблиця — чесне «private», не порожній результат", () => {
    expect(s()).toMatch(/if \(res\.url\.includes\("accounts\.google\.com"\) \|\| ct\.includes\("text\/html"\) \|\| res\.status === 401 \|\| res\.status === 403\) \{\s*return json\(403, \{ error: "private" \}\);/);
  });

  it("межі: 1 МБ, 500 рядків, 15 с, стеля 30/год у базі, лише для залогіненого", () => {
    const src = s();
    expect(src).toMatch(/export const MAX_BYTES = 1_000_000;/);
    expect(src).toMatch(/export const MAX_ROWS = 500;/);
    expect(src).toMatch(/const FETCH_TIMEOUT_MS = 15_000;/);
    expect(src).toMatch(/rateLimit\(admin, "import_sheet_fetch", user\.id, PER_TUTOR_HOUR, 3600\)/);
    expect(src).toMatch(/if \(!user\) return json\(401, \{ error: "unauthorized" \}\);/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.import-sheet-fetch\]\s*\n\s*verify_jwt = true/);
  });
});

describe("клієнт: три джерела — один екран підтвердження", () => {
  const s = () => noComments(read("src/components/ImportStudentsSheet.tsx"));
  it("таблиця стає канонічними рядками в полі — людина бачить, що ми зрозуміли", () => {
    const src = s();
    expect(src).toMatch(/const canonical = toCanonicalText\(parsedRows, kw\);\s*setText\(canonical\);/);
    expect(src).toMatch(/supabase\.functions\.invoke\("import-sheet-fetch", \{ body: \{ url: sheetUrl\.trim\(\) \} \}\)/);
    expect(src).toMatch(/accept="\.csv,\.tsv,\.txt,text\/csv,text\/plain"/);
  });
  it("кожна відмова сервера має людський текст", () => {
    const src = s();
    for (const k of ["sheetPrivate", "sheetBadUrl", "sheetRateLimited", "sheetTooBig", "sheetFailed"]) expect(src).toContain(k);
  });
});

describe("онбординг: перший крок пропонує перенести все, а не додавати по одному", () => {
  it("кнопка «Перенести все, що є» відкриває той самий імпорт", () => {
    const src = noComments(read("src/components/OnboardingFlowB.tsx"));
    expect(src).toMatch(/onImportAll=\{\(\) => setHandoffOpen\(true\)\}/);
    expect(src).toMatch(/onboardingFlowB\.studentImportAll/);
  });
});
