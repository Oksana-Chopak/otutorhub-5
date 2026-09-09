/**
 * Рахунок для лендінгу «порахуй свої гроші» (рішення власниці 09.09).
 *
 * ЧОМУ ОКРЕМА ЧИСТА ФУНКЦІЯ, а не formula всередині компонента: число на
 * лендінгу мусить ДОРІВНЮВАТИ числу, яке людина побачить у застосунку після
 * реєстрації. Розбіжність убиває довіру рівно в той момент, коли вона щойно
 * зʼявилась. Тому борг і передоплата беруться з тієї САМОЇ netDebtAndPrepay,
 * якою рахує імпорт, а горизонт — ті самі 4 тижні, на які імпорт створює
 * розклад. Одна логіка, два екрани.
 *
 * Прогноз тут — АРИФМЕТИКА, не обіцянка зростання: скільки виходить із того,
 * що людина сама ввела. Жодних «ти зростеш на 30%».
 */
import { IMPORT_SCHEDULE_WEEKS, netDebtAndPrepay, type ParsedStudent } from "@/lib/importStudents";

/** Горизонт беремо з імпорту, а не дублюємо: одна константа на два екрани. */
export const CALC_WEEKS = IMPORT_SCHEDULE_WEEKS;

export interface MoneyPreview {
  students: number;
  withPrice: number;
  withoutPrice: number;
  /** Уроків за 4 тижні (з розкладу або за припущенням «раз на тиждень»). */
  lessonsPerMonth: number;
  /** ₴ за 4 тижні за поточними ставками. */
  monthly: number;
  /** Скільки винні ЗАРАЗ (нетто, як його створить імпорт). */
  owed: number;
  owedStudents: number;
  /** Передоплати на руках. */
  prepaid: number;
  prepaidStudents: number;
  /** Учні без розкладу: уроків не дають, бо імпорт їх теж не створить. */
  noScheduleStudents: number;
  /** Борг, який неможливо оцінити: заданий уроками, а ставки немає. */
  unvaluedDebtStudents: number;
}

const EMPTY: MoneyPreview = {
  students: 0, withPrice: 0, withoutPrice: 0, lessonsPerMonth: 0, monthly: 0,
  owed: 0, owedStudents: 0, prepaid: 0, prepaidStudents: 0, noScheduleStudents: 0, unvaluedDebtStudents: 0,
};

export function calcMoneyPreview(rows: ParsedStudent[]): MoneyPreview {
  const valid = rows.filter((r) => !r.error);
  if (valid.length === 0) return EMPTY;

  const out: MoneyPreview = { ...EMPTY, students: valid.length };

  for (const r of valid) {
    const price = r.price ?? 0;
    if (price > 0) out.withPrice++; else out.withoutPrice++;

    // Уроки — ТІЛЬКИ з розкладу, бо рівно стільки їх створить імпорт.
    // Жодних «припустимо, раз на тиждень»: обіцяне на лендінгу число впало б
    // після реєстрації, а це найдорожча брехня з усіх можливих.
    if (r.schedule.length === 0) out.noScheduleStudents++;
    const lessons = r.schedule.length * CALC_WEEKS;
    out.lessonsPerMonth += lessons;
    out.monthly += lessons * price;

    // Борг і передоплата — формула підсумку ImportStudentsSheet, слово в слово.
    // Тут не симетрія заради краси: netDebtAndPrepay САМА переводить борг-уроки
    // у гроші, коли є ставка, а передоплату-уроки — лише якщо є чим гасити борг.
    // Тому «передоплата 3» без боргу лишається уроками, і перша версія цього
    // файлу (яка брала тільки prepayAmount) показувала 0 замість 1500.
    const net = netDebtAndPrepay(r);
    const debt = net.debtAmount + price * net.debtLessons;
    const prepay = net.prepayAmount + price * net.prepayLessons;
    if (debt > 0) { out.owed += debt; out.owedStudents++; }
    if (prepay > 0) { out.prepaid += prepay; out.prepaidStudents++; }
    // Борг заданий уроками, а ставки немає — оцінити нічим (імпорт теж дасть 0).
    if (net.debtLessons > 0 && price <= 0) out.unvaluedDebtStudents++;
  }

  return out;
}
