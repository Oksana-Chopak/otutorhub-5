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
import { IMPORT_SCHEDULE_WEEKS, netDebtAndPrepay, scheduleToStarts, type ParsedStudent } from "@/lib/importStudents";

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
  /** «не оплатила», «винен» без суми — борг є, цифри людина не написала. */
  flaggedDebtStudents: number;
}

const EMPTY: MoneyPreview = {
  students: 0, withPrice: 0, withoutPrice: 0, lessonsPerMonth: 0, monthly: 0,
  owed: 0, owedStudents: 0, prepaid: 0, prepaidStudents: 0, noScheduleStudents: 0, unvaluedDebtStudents: 0,
  flaggedDebtStudents: 0,
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
    if (r.debtFlag) out.flaggedDebtStudents++;
  }

  return out;
}

/* ── «Твій завтрашній ранок» (10.09) ─────────────────────────────────────────
   Цифри «винні / за місяць» приємні й забуваються. Те, що людина пересилає
   колезі, — це коли застосунок говорить про ЇЇ понеділок ще до реєстрації:
   імена, час, хто винен. Тут — та сама арифметика, що й вище, лише розкладена
   по людях і днях, як її покаже ранковий дайджест у Telegram. Час для
   найближчого дня береться з того самого scheduleToStarts, що створює уроки
   імпорт: дата на лендінгу = дата першого уроку після реєстрації. */

export interface DigestLesson { time: string; name: string }
export interface DigestDebtor {
  name: string;
  /** ₴ (нетто, як його створить імпорт); 0, якщо борг заданий уроками без ставки. */
  amount: number;
  /** Борг уроками без ставки — показуємо «2 уроки», а не 0 ₴. */
  lessons: number;
  /** «не оплатила» без суми: у списку є, цифри — нема. */
  unknown?: boolean;
}
export interface DigestPreview {
  /** Найближчий день із розкладу; null, коли розкладу ніхто не дописав. */
  day: { date: Date; lessons: DigestLesson[] } | null;
  /** Хто винен — від найбільшої суми. */
  debtors: DigestDebtor[];
}

/** Імʼя як у дайджесті: ім'я, а прізвище — лише щоб розвести тезок. */
function digestNames(rows: ParsedStudent[]): Map<ParsedStudent, string> {
  const byFirst = new Map<string, number>();
  for (const r of rows) byFirst.set(r.firstName, (byFirst.get(r.firstName) ?? 0) + 1);
  const out = new Map<ParsedStudent, string>();
  for (const r of rows) {
    const dup = (byFirst.get(r.firstName) ?? 0) > 1;
    out.set(r, dup && r.lastName ? `${r.firstName} ${r.lastName[0]}.` : r.firstName);
  }
  return out;
}

/**
 * Дата дайджесту людською мовою: «Пʼятниця, 11 вересня».
 *
 * ЧОМУ НЕ ОДНИМ Intl-викликом. Скелет {weekday, day, month} в українській
 * локалі Chromium дає ЗНАХІДНИЙ відмінок — «пʼятницю, 11 вересня», «суботу,
 * 12 вересня». Після «Доброго ранку!» це читається як помилка, і саме так
 * воно й виглядало на першому екрані лендінгу. У Node ICU інша й віддає
 * називний, тому тест у CI цього не ловив — баг видно лише в браузері.
 * Тому день тижня форматуємо ОКРЕМО (там завжди називний) і склеюємо самі.
 */
export function formatDigestDay(date: Date, locale: string): string {
  try {
    const wd = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date);
    const dm = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(date);
    return `${wd.charAt(0).toLocaleUpperCase(locale)}${wd.slice(1)}, ${dm}`;
  } catch {
    return "";
  }
}

export function digestPreview(rows: ParsedStudent[], now: Date = new Date()): DigestPreview {
  const valid = rows.filter((r) => !r.error);
  const names = digestNames(valid);

  // Найближчий урок кожного учня → найраніший день → усі уроки того дня.
  const firsts: Array<{ at: Date; r: ParsedStudent }> = [];
  for (const r of valid) {
    if (r.schedule.length === 0) continue;
    for (const at of scheduleToStarts(r.schedule, 1, now)) firsts.push({ at, r });
  }
  let day: DigestPreview["day"] = null;
  if (firsts.length > 0) {
    firsts.sort((a, b) => a.at.getTime() - b.at.getTime());
    const first = firsts[0].at;
    const sameDay = (d: Date) =>
      d.getFullYear() === first.getFullYear() && d.getMonth() === first.getMonth() && d.getDate() === first.getDate();
    const lessons = firsts
      .filter((f) => sameDay(f.at))
      .map((f) => ({
        time: `${String(f.at.getHours()).padStart(2, "0")}:${String(f.at.getMinutes()).padStart(2, "0")}`,
        name: names.get(f.r) ?? f.r.firstName,
      }));
    day = { date: first, lessons };
  }

  const debtors: DigestDebtor[] = [];
  for (const r of valid) {
    const price = r.price ?? 0;
    const net = netDebtAndPrepay(r);
    const amount = net.debtAmount + price * net.debtLessons;
    const lessons = price > 0 ? 0 : net.debtLessons;
    if (amount > 0 || lessons > 0) debtors.push({ name: names.get(r) ?? r.firstName, amount, lessons });
    else if (r.debtFlag) debtors.push({ name: names.get(r) ?? r.firstName, amount: 0, lessons: 0, unknown: true });
  }
  debtors.sort((a, b) => b.amount - a.amount || b.lessons - a.lessons);

  return { day, debtors };
}
