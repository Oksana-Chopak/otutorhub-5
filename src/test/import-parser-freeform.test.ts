/**
 * Парсер після провалу на лендінгу 12.09: власниця вставила СВІЙ список
 * боргів — і «нічого не відбулось». Кожен рядок тут — те, як люди пишуть
 * у нотатках насправді, а не канон із документації. Якщо один із них
 * знову стане «ціною» або нотаткою — лендінг знову брехатиме.
 */
import { describe, it, expect } from "vitest";
import { parseStudentLine, parseStudentList, toCanonicalText, netDebtAndPrepay, type CanonicalWords } from "@/lib/importStudents";
import { calcMoneyPreview, digestPreview } from "@/lib/landingCalc";

const D = (l: string) => parseStudentLine(l, { mode: "debts" })!;
const I = (l: string) => parseStudentLine(l, { mode: "import" })!;

describe("режим «debts» — «хто вам винен», як у нотатках", () => {
  it("імʼя відрізається без роздільника — на цифрі, ключовому слові, двокрапці", () => {
    expect(D("Артем 1500")).toMatchObject({ firstName: "Артем", lastName: "", debtAmount: 1500, price: null });
    expect(D("Марта: 1200")).toMatchObject({ firstName: "Марта", debtAmount: 1200 });
    expect(D("Соня винна за 2 уроки")).toMatchObject({ firstName: "Соня", debtLessons: 2 });
    expect(D("Оля заборгувала 3 заняття")).toMatchObject({ firstName: "Оля", lastName: "", debtLessons: 3 });
    expect(D("Іван Петренко заборгував 500")).toMatchObject({ firstName: "Іван", lastName: "Петренко", debtAmount: 500 });
  });
  it("голе число — борг: гроші, якщо велике; уроки, якщо ≤ 30", () => {
    expect(D("Маша - 1200 грн")).toMatchObject({ debtAmount: 1200, debtLessons: null });
    expect(D("Катя 2 уроки")).toMatchObject({ debtLessons: 2, debtAmount: null });
    expect(D("Микола 900")).toMatchObject({ debtAmount: 900 });
    expect(D("Іра — 3")).toMatchObject({ debtLessons: 3 });
  });
  it("фрази боргу з прикметниками, контекстом і без суми", () => {
    expect(D("Максим — англійська — 3 неоплачені уроки")).toMatchObject({ subject: "англійська", debtLessons: 3 });
    expect(D("Ігор - борг 800 грн за вересень")).toMatchObject({ debtAmount: 800, note: "вересень", subject: null });
    expect(D("Даша не оплатила вересень")).toMatchObject({ debtFlag: true, debtAmount: null, debtLessons: null, note: "вересень" });
    expect(D("Соломія - вересень не оплачено")).toMatchObject({ debtFlag: true, subject: null });
    expect(D("Тарас 1200 (за 2 уроки)")).toMatchObject({ debtAmount: 1200, note: "2 уроки" });
  });
  it("«по 400» — ціна; «2 уроки — 800» — сума й є борг, уроки в нотатку", () => {
    const r = D("Ліза - 2 уроки по 400");
    expect(r).toMatchObject({ price: 400, debtLessons: 2 });
    expect(netDebtAndPrepay(r).debtAmount).toBe(800);
    expect(D("Аня — 1 урок — 500 грн")).toMatchObject({ debtAmount: 500, debtLessons: null, note: "1 урок" });
  });
  it("«не оплатив 3 уроки» — борг, а не передоплата; «оплатила наперед 4 уроки» — передоплата", () => {
    expect(D("Артем — по 450 — пн, чт 17:00 — не оплатив 3 уроки")).toMatchObject({ price: 450, debtLessons: 3, prepayLessons: null });
    expect(D("Оля — по 500 — вт 18:00 — оплатила наперед 4 уроки")).toMatchObject({ price: 500, prepayLessons: 4, debtLessons: null });
    expect(D("Юля оплатила 2000 наперед")).toMatchObject({ prepayAmount: 2000 });
  });
  it("імена, що збігаються з днями тижня чи предметами, лишаються іменами", () => {
    expect(D("Tor 900")).toMatchObject({ firstName: "Tor", debtAmount: 900 });
    expect(D("Оля пн 18:00 винна 2 уроки")).toMatchObject({ firstName: "Оля", debtLessons: 2 });
    expect(D("Оля пн 18:00 винна 2 уроки").schedule).toEqual([{ weekday: 1, time: "18:00" }]);
    expect(D("Максим англійська 500")).toMatchObject({ firstName: "Максим", subject: "англійська", debtAmount: 500 });
  });
  it("заголовки й маркери списку не стають учнями", () => {
    const rows = parseStudentList("борги:\n- Іра 600\n• Тарас 700\nМої учні:\n1) Оля 800", { mode: "debts" });
    expect(rows.map((r) => r.firstName)).toEqual(["Іра", "Тарас", "Оля"]);
  });
  it("реальний список власниці дає дайджест з іменами й сумою, а не порожнечу", () => {
    const rows = parseStudentList(
      "Соня винна за 2 уроки\nМаша - 1200 грн\nАртем 1500\nДаша не оплатила вересень\nІгор - борг 800 грн за вересень\nОля заборгувала 3 заняття, по 400, вт 16:30",
      { mode: "debts" },
    );
    const calc = calcMoneyPreview(rows);
    expect(calc.students).toBe(6);
    expect(calc.owed).toBe(1200 + 1500 + 800 + 3 * 400);
    expect(calc.flaggedDebtStudents).toBe(1);
    const digest = digestPreview(rows, new Date("2026-09-12T10:00:00"));
    expect(digest.debtors.map((d) => d.name)).toEqual(["Артем", "Маша", "Оля", "Ігор", "Соня", "Даша"]); // 1200 = 1200 — стабільний порядок списку
    expect(digest.debtors.at(-1)).toMatchObject({ name: "Даша", unknown: true });
    expect(digest.day?.lessons).toEqual([{ time: "16:30", name: "Оля" }]);
  });
});

describe("режим «import» — канон застосунку не зрушив", () => {
  it("голе число — ціна, як і раніше; «2 уроки» без слова — нотатка", () => {
    expect(I("Артем 1500")).toMatchObject({ price: 1500, debtAmount: null });
    expect(I("Маша - 1200 грн")).toMatchObject({ price: 1200 });
    expect(I("Катя 2 уроки")).toMatchObject({ price: null, debtLessons: null, note: "2 уроки" });
  });
  it("але фрази читаються так само, як на лендінгу", () => {
    expect(I("Соня винна за 2 уроки")).toMatchObject({ debtLessons: 2 });
    expect(I("Ігор - борг 800 грн за вересень")).toMatchObject({ debtAmount: 800 });
    expect(I("Даша не оплатила вересень")).toMatchObject({ debtFlag: true });
  });
});

describe("канонічний рядок: лендінг → імпорт без втрат", () => {
  const kw: CanonicalWords = { debt: "борг", prepay: "передоплата", lessons: "уроки", money: "грн", min: "хв", day: (d) => ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"][d] };
  it("те, що розібрано в «debts», імпорт читає однаково", () => {
    const text = "Соня винна за 2 уроки\nМаша - 1200 грн\nАртем 1500\nОля — по 400 — вт,чт 16:30 — заборгувала 3 заняття — оплатила наперед 1 урок\nІгор — англійська — 800 грн за вересень — +380671234567";
    const debts = parseStudentList(text, { mode: "debts" });
    const canon = toCanonicalText(debts, kw);
    expect(canon).toContain("Артем — борг 1500 грн");
    expect(canon).toContain("Оля — 400 — борг 3 уроки — передоплата 1 уроки — вт,чт 16:30");
    const back = parseStudentList(canon, { mode: "import" });
    const strip = (r: ReturnType<typeof I>) => ({ n: r.firstName, s: r.subject, p: r.price, dA: r.debtAmount, dL: r.debtLessons, pA: r.prepayAmount, pL: r.prepayLessons, sch: r.schedule, ph: r.phone });
    expect(back.map(strip)).toEqual(debts.map(strip));
    expect(calcMoneyPreview(back).owed).toBe(calcMoneyPreview(debts).owed);
  });
  it("борг без суми лишається словом у нотатці — імпорт нічого не вигадує", () => {
    const rows = parseStudentList("Даша не оплатила вересень", { mode: "debts" });
    const canon = toCanonicalText(rows, kw);
    expect(canon).toBe("Даша — борг · вересень");
    expect(parseStudentList(canon)[0]).toMatchObject({ debtAmount: null, debtLessons: null, debtFlag: true });
  });
});
