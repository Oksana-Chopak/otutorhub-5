/**
 * Число на лендінгу мусить дорівнювати числу в застосунку — інакше довіра
 * згорає рівно там, де щойно народилась.
 *
 * Ключовий тест тут — «дзеркало підсумку імпорту»: він повторює формулу
 * ImportStudentsSheet (сума + уроки за ставкою) і вимагає збігу до копійки.
 * Перша версія калькулятора брала лише .prepayAmount і тому МОВЧКИ губила
 * передоплату, задану уроками («передоплата 3» без боргу): на лендінгу 0,
 * у застосунку — 1500 ₴.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IMPORT_SCHEDULE_WEEKS, parseStudentList, netDebtAndPrepay } from "@/lib/importStudents";
import { calcMoneyPreview, CALC_WEEKS, formatDigestDay } from "@/lib/landingCalc";

const P = (t: string) => calcMoneyPreview(parseStudentList(t));

describe("лендінг · рахунок грошей", () => {
  it("порожній ввід — усі нулі, жодного NaN", () => {
    const r = P("");
    expect(r).toMatchObject({ students: 0, monthly: 0, owed: 0 });
    for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
  });

  it("розклад із двох днів дає 2×4 уроки і ціну×8", () => {
    const r = P("Марія — англійська — 600 — пн 18:00, чт 18:00");
    expect(r.lessonsPerMonth).toBe(2 * CALC_WEEKS);
    expect(r.monthly).toBe(600 * 2 * CALC_WEEKS);
    expect(r.noScheduleStudents).toBe(0);
  });

  it("без розкладу — НЕ вигадуємо уроків: імпорт їх теж не створить", () => {
    const r = P("Іван — математика — 500");
    expect(r.lessonsPerMonth).toBe(0);
    expect(r.monthly).toBe(0);
    expect(r.noScheduleStudents).toBe(1); // підпис кличе дописати день і час
  });

  it("учень без ціни не додає грошей і не вигадує їх", () => {
    const r = P("Соломія\nПетро - фізика");
    expect(r.students).toBe(2);
    expect(r.withoutPrice).toBe(2);
    expect(r.monthly).toBe(0);
    expect(r.lessonsPerMonth).toBe(0);
  });

  it("борг, передоплата й уроки — дзеркало підсумку ImportStudentsSheet", () => {
    const text = [
      "Марія — англійська — 600 — борг 1200 — пн 18:00",
      "Іван — 500 — борг 2 уроки",            // борг УРОКАМИ зі ставкою
      "Оля — 350 — передоплата 3 — вт 16:00",  // передоплата УРОКАМИ
      "Ната — 700 — передоплата 1500",
      "Тарас — борг 2 уроки",                  // ставки немає — оцінити нічим
    ].join("\n");
    const rows = parseStudentList(text);

    // Формула зі src/components/ImportStudentsSheet.tsx (summary), 1:1.
    let debt = 0, prepay = 0, lessons = 0;
    for (const r of rows.filter((x) => !x.error)) {
      const n = netDebtAndPrepay(r);
      debt += n.debtAmount + (r.price ?? 0) * n.debtLessons;
      prepay += n.prepayAmount + (r.price ?? 0) * n.prepayLessons;
      lessons += r.schedule.length * IMPORT_SCHEDULE_WEEKS;
    }

    const c = P(text);
    expect(c.owed).toBe(debt);
    expect(c.prepaid).toBe(prepay);
    expect(c.lessonsPerMonth).toBe(lessons);
    expect(debt).toBe(1200 + 500 * 2);      // борг уроками ОБОВʼЯЗКОВО в сумі
    expect(prepay).toBe(350 * 3 + 1500);
  });

  it("горизонт лендінгу — та сама константа, що й у імпорті", () => {
    expect(CALC_WEEKS).toBe(IMPORT_SCHEDULE_WEEKS);
  });

  it("передоплата гасить борг того самого учня — на лендінгу теж", () => {
    const r = P("Марія — 600 — борг 1200 — передоплата 1200");
    expect(r.owed).toBe(0);
    expect(r.prepaid).toBe(0);
  });

  it("борг уроками без ставки — рахуємо ЛЮДЕЙ, а не вигадані гроші", () => {
    const r = P("Оля — борг 3 уроки");
    expect(r.owed).toBe(0);
    expect(r.unvaluedDebtStudents).toBe(1);
  });

  it("зламані рядки не потрапляють у жодну суму", () => {
    const r = P("Марія — 600 — пн 18:00\n\n   \n— — —");
    expect(r.students).toBe(1);
    expect(r.monthly).toBe(600 * CALC_WEEKS);
  });
});

describe("передоплата видима", () => {
  it("рахує і суму, і кількість учнів з передоплатою", () => {
    const rows = parseStudentList(
      "Іван; 500; передоплата 3\nНата — 700 — передоплата 1500\nПетро — 400 — борг 800",
    );
    const c = calcMoneyPreview(rows);
    expect(c.prepaid).toBe(500 * 3 + 1500); // «передоплата 3» = 3 уроки за ставкою
    expect(c.prepaidStudents).toBe(2);
    expect(c.owed).toBe(800);
    expect(c.owedStudents).toBe(1);
  });

  it("список з самих передоплат: боргу нема, але гроші видно", () => {
    const c = calcMoneyPreview(parseStudentList("Іван; 500; передоплата 2"));
    expect(c.owed).toBe(0);
    expect(c.prepaid).toBe(1000);
    expect(c.prepaidStudents).toBe(1);
  });
});

/* «Твій завтрашній ранок» (10.09): результат калькулятора — дайджест з іменами
   й часом. Та сама арифметика, що й вище, розкладена по людях і днях; дата
   найближчого дня — з того самого scheduleToStarts, що створює уроки імпорт. */
import { digestPreview } from "@/lib/landingCalc";
const D = (t: string, now: Date) => digestPreview(parseStudentList(t), now);

describe("лендінг · дайджест «твій завтрашній ранок»", () => {
  const fri = new Date(2026, 8, 11, 10, 0, 0); // пʼятниця 11.09.2026, 10:00
  it("найближчий день із розкладу і всі уроки того дня — за часом", () => {
    const d = D("Марія — 600 — пн 18:00\nІван — 500 — вт,чт 16:30\nОля — 350 — пн 16:00\nМарко — 400", fri);
    expect(d.day?.date.getDay()).toBe(1);        // понеділок 14.09
    expect(d.day?.date.getDate()).toBe(14);
    expect(d.day?.lessons).toEqual([{ time: "16:00", name: "Оля" }, { time: "18:00", name: "Марія" }]);
  });
  it("без розкладу дня немає — і жодних «припустимо»", () => {
    expect(D("Марія — 600 — борг 1200\nМарко — 400", fri).day).toBeNull();
  });
  it("боржники — від найбільшої суми, нетто як в імпорті; уроки без ставки — уроками", () => {
    const d = D("Марія — 600 — борг 1200\nСофія — 450 — борг 900\nОля — 350 — борг 2 уроки\nПетро — борг 2 уроки\nІван — 500 — передоплата 3", fri);
    expect(d.debtors.map((x) => [x.name, x.amount, x.lessons])).toEqual([
      ["Марія", 1200, 0], ["Софія", 900, 0], ["Оля", 700, 0], ["Петро", 0, 2],
    ]);
    // сума боржників = «винні зараз» з грошового рахунку (одна арифметика, два рядки)
    const owed = d.debtors.reduce((s, x) => s + x.amount, 0);
    expect(owed).toBe(P("Марія — 600 — борг 1200\nСофія — 450 — борг 900\nОля — 350 — борг 2 уроки\nПетро — борг 2 уроки\nІван — 500 — передоплата 3").owed);
  });
  it("тезки розводяться ініціалом прізвища, решта — лише імʼя", () => {
    const d = D("Марія Коваль — 600 — борг 100\nМарія Шевченко — 600 — борг 50\nОля Іванова — 350 — борг 20", fri);
    expect(d.debtors.map((x) => x.name)).toEqual(["Марія К.", "Марія Ш.", "Оля"]);
  });
});

describe("дата дайджесту · відмінок", () => {
  it("день тижня — у називному, а не «пʼятницю»", () => {
    const d = new Date(2026, 8, 11); // пʼятниця
    const label = formatDigestDay(d, "uk");
    // Еталон — Intl із самим weekday: він ЗАВЖДИ дає називний відмінок.
    const nominative = new Intl.DateTimeFormat("uk", { weekday: "long" }).format(d);
    expect(label.toLocaleLowerCase("uk")).toContain(nominative.toLocaleLowerCase("uk"));
    expect(label).toMatch(/^[А-ЯІЇЄҐA-Z]/);           // з великої літери
    expect(label).toContain(new Intl.DateTimeFormat("uk", { day: "numeric", month: "long" }).format(d));
  });

  it("не збирає дату одним скелетом — саме він давав знахідний у Chromium", () => {
    // Джерельний запобіжник: у Node ICU обидва варіанти дають називний, тож
    // поведінковий тест сам по собі регресію не впіймав би.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../lib/landingCalc.ts"), "utf8");
    expect(src).not.toMatch(/weekday:\s*"long",\s*day:/);
    expect(src).toMatch(/weekday: "long" \}\)/);
  });

  it("порожня дата не ламає підпис", () => {
    expect(formatDigestDay(new Date(NaN), "uk")).toBe("");
  });
});
