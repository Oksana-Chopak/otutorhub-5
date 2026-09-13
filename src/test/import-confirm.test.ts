/**
 * 13.09 — екран підтвердження імпорту («вау фіча, а не вау фу»):
 *  - правка дотиком живе поверх парсера (applyOverride) і перераховує
 *    попередження;
 *  - невпізнане З ЧИСЛОМ не лягає мовчки в нотатку — unsureNote знаходить
 *    фрагмент, resolveUnsure застосовує відповідь людини, число береться лише
 *    з рядка (ніколи не вигадується);
 *  - анонімна «форма» невпізнаного не містить імен і сум;
 *  - словник: «не розрахувалась» / «не розплатився» = борг.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseStudentLine,
  applyOverride,
  computeWarnings,
  unsureNote,
  resolveUnsure,
  unrecognizedShape,
} from "@/lib/importStudents";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const line = (s: string) => parseStudentLine(s, { mode: "import" })!;

describe("словник боргу з реальних нотаток", () => {
  it("«ще не розрахувалась» / «не розплатився» — борг без суми", () => {
    const a = line("Оля за минулий місяць ще не розрахувалась");
    expect(a.firstName).toBe("Оля");
    expect(a.debtFlag).toBe(true);
    expect(a.debtAmount).toBeNull();
    const b = line("Петро — не розплатився");
    expect(b.debtFlag).toBe(true);
  });
  it("«не закрила тему» — НЕ борг (точність важливіша за повноту)", () => {
    const a = line("Іра — англійська — не закрила тему");
    expect(a.debtFlag).toBe(false);
    expect(a.debtAmount).toBeNull();
  });
  it("телефон усередині хвоста впізнається, а не стає «невпізнаним числом»", () => {
    const a = parseStudentLine("Настя +380501234567 борг 900", { mode: "debts" })!;
    expect(a.phone).toBe("+380501234567");
    expect(a.debtAmount).toBe(900);
    expect(a.note).toBeNull();
    const b = line("Ваня — тел 067 123 45 67 — англійська — 500");
    expect(b.phone).toBe("0671234567");
    expect(b.price).toBe(500);
    expect(b.subject).toBe("англійська");
    expect(b.note).toBeNull(); // «тел» — підпис, не нотатка
    // три суми поспіль — не телефон
    const c = line("Петро — 1200 800 400");
    expect(c.phone).toBeNull();
  });
  it("число ПЕРЕД боргом в уроках — ставка, а не другий борг (обидва режими)", () => {
    for (const mode of ["debts", "import"] as const) {
      const a = parseStudentLine("Марко — 600 — борг 2 уроки", { mode })!;
      expect(a.price, mode).toBe(600);
      expect(a.debtLessons, mode).toBe(2);
      expect(a.debtAmount, mode).toBeNull();
      const b = parseStudentLine("Оля 500 винна 3 заняття", { mode })!;
      expect(b.price, mode).toBe(500);
      expect(b.debtLessons, mode).toBe(3);
    }
    // а число ПІСЛЯ уроків на лендінгу — підсумок (стара домовленість лишається)
    const c = parseStudentLine("Соня винна за 2 уроки — 1200", { mode: "debts" })!;
    expect(c.debtAmount).toBe(1200);
    expect(unsureNote(c)).toBeNull(); // фраза «винна за 2 уроки» в нотатці — пояснення, не питання
    const d = parseStudentLine("Маша 1200 борг", { mode: "debts" })!;
    expect(d.debtAmount).toBe(1200); // «борг» без уроків — це борг, не ставка
  });
});

describe("правка дотиком (applyOverride)", () => {
  it("ціна, дописана дотиком, знімає попередження «борг уроками без ціни»", () => {
    const r = line("Соня — борг 2 уроки");
    expect(r.warnings).toContain("debt_lessons_need_price");
    const fixed = applyOverride(r, { price: 450 });
    expect(fixed.price).toBe(450);
    expect(fixed.warnings).not.toContain("debt_lessons_need_price");
    expect(fixed.debtLessons).toBe(2);
  });
  it("сума, дописана до «не оплатила», перетворює борг-без-суми на борг сумою", () => {
    const r = line("Даша не оплатила вересень");
    expect(r.debtFlag).toBe(true);
    const fixed = applyOverride(r, { debtAmount: 1200 });
    expect(fixed.debtFlag).toBe(false);
    expect(fixed.debtAmount).toBe(1200);
  });
  it("порожня правка (null) прибирає значення; без правки — рядок той самий", () => {
    const r = line("Маша — 600 — борг 1200");
    expect(applyOverride(r, undefined)).toBe(r);
    const cleared = applyOverride(r, { debtAmount: null });
    expect(cleared.debtAmount).toBeNull();
    expect(computeWarnings(cleared)).toEqual([]);
  });
});

describe("«не впізнав» з числом (unsureNote / resolveUnsure)", () => {
  const r = line("Маша — 600 — за минулий місяць 800");
  it("число в нотатці не губиться мовчки — стає питанням", () => {
    expect(r.price).toBe(600);
    const u = unsureNote(r);
    expect(u).not.toBeNull();
    expect(u!.value).toBe(800);
    expect(u!.fragment).toMatch(/800/);
  });
  it("відповідь «борг» бере число лише з фрагмента і прибирає його з нотатки", () => {
    const o = resolveUnsure(r, undefined, "debtAmount");
    const fixed = applyOverride(r, o);
    expect(fixed.debtAmount).toBe(800);
    expect(fixed.note ?? "").not.toMatch(/800/);
    expect(unsureNote(r, o)).toBeNull(); // питання зникло
  });
  it("відповідь «нотатка» лишає текст як є і більше не питає", () => {
    const o = resolveUnsure(r, undefined, "note");
    expect(applyOverride(r, o).note).toBe(r.note);
    expect(unsureNote(r, o)).toBeNull();
  });
  it("«ціна» і «передоплата» — так само з фрагмента; дата («1 числа») не є питанням", () => {
    expect(applyOverride(r, resolveUnsure(r, undefined, "price")).price).toBe(800);
    expect(applyOverride(r, resolveUnsure(r, undefined, "prepayAmount")).prepayAmount).toBe(800);
    const d = line("Ваня — 500 — мама платить 1 числа");
    expect(d.note).toMatch(/1 числа/);
    expect(unsureNote(d)).toBeNull();
  });
});

describe("анонімна форма невпізнаного", () => {
  it("без імен і сум: цифри → #, слова з великої → х", () => {
    const s = unrecognizedShape("за минулий місяць 800 Олена платить");
    expect(s).not.toMatch(/800|олена/);
    expect(s).toBe("за минулий місяць # х платить");
  });
});

describe("екран підтвердження в ImportStudentsSheet", () => {
  const sheet = readFileSync(join(root, "src/components/ImportStudentsSheet.tsx"), "utf8");
  it("правки — поверх парсера, ключ = оригінальний рядок; імпорт іде з ВИПРАВЛЕНИХ рядків", () => {
    expect(sheet).toMatch(/parsed\.map\(\(r\) => applyOverride\(r, overrides\[r\.raw\]\)\)/);
    expect(sheet).toMatch(/const valid = rows\.filter/);
    expect(sheet).toMatch(/for \(let i = 0; i < valid\.length; i\+\+\)/);
  });
  it("грошові чипи редагуються дотиком; невпізнане з числом питає «що це?» з пʼятьма відповідями", () => {
    expect(sheet).toMatch(/function EditChip\(/);
    for (const f of ["\"price\"", "\"debtAmount\"", "\"debtLessons\"", "\"prepayAmount\"", "\"prepayLessons\""]) expect(sheet).toContain(`chip(${f}`);
    expect(sheet).toMatch(/importStudents\.unsureQuestion/);
    for (const c of ["debtAmount", "debtLessons", "prepayAmount", "price", "note"]) expect(sheet).toContain(`["${c}", t("importStudents.unsure`);
  });
  it("зони дотику ≥ 44px, поле 15px (iOS не зумить); рядки без імені названі, не «пропустимо»", () => {
    expect(sheet).toMatch(/inline-flex h-11 items-center gap-1 rounded-full border-\[0\.5px\] border-dashed/);
    expect(sheet).toMatch(/text-\[15px\] text-foreground focus:outline-none/);
    expect(sheet).toMatch(/importStudents\.noNameLine/);
    expect(sheet).not.toMatch(/importStudents\.lineSkipped/);
  });
  it("анонімні форми невпізнаного логуються без імен (unrecognizedShape), не сирі рядки", () => {
    expect(sheet).toMatch(/logEvent\("import_unrecognized"/);
    expect(sheet).toMatch(/unrecognizedShape\(u!\.fragment\)/);
    expect(sheet).not.toMatch(/shapes.*r\.raw\b(?!\.split)/);
  });
});

describe("рядок про батьків — не учень", () => {
  it("«мама Олена платить 1 числа» → «не впізнав імʼя», а не учень на імʼя «мама»", () => {
    const r = parseStudentLine("мама Олена платить 1 числа", { mode: "import" })!;
    expect(r.error).toBe("empty_name");
    expect(parseStudentLine("Марія Коваль — 600", { mode: "import" })!.error).toBeNull();
  });
});
