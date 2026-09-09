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
import { IMPORT_SCHEDULE_WEEKS, parseStudentList, netDebtAndPrepay } from "@/lib/importStudents";
import { calcMoneyPreview, CALC_WEEKS } from "@/lib/landingCalc";

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
