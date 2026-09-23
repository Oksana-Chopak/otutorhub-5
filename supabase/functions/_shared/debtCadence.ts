/**
 * Коли помічник нагадує учню про НЕОПЛАЧЕНИЙ ПРОВЕДЕНИЙ урок.
 *
 * Привід (15.09): жива база показала 69 боргів, 68 із них старші за добу — і
 * рівно НУЛЬ автоматичних нагадувань за 30 днів, хоча погодинний крон щоразу
 * відпрацьовував успішно. Причина не в каналі й не в розкладі: нагадування
 * вміло спрацювати лише у вузькому вікні (2 доби навколо строку оплати) і
 * рівно ОДИН раз на урок. Борг же не має строку придатності — він живе, доки
 * не оплачений. Тобто обіцянка продукту («Учні платять вчасно. Ви не
 * нагадуєте») мовчки не виконувалась для ВСІХ давніх боргів, а найбільше —
 * для перенесених імпортом, у яких дата завжди в минулому.
 *
 * Рішення власниці 15.09: раз на 3 дні, максимум 4 рази. Після цього борг
 * лишається видимим у застосунку й у ранковому дайджесті репетитора, але
 * учня більше не турбуємо — напоминання, яке не спрацювало чотири рази,
 * п'ятого разу не спрацює теж, а от у спам перетвориться.
 *
 * Лічильник ведеться по ПАРІ (репетитор, учень), а не по уроку: якщо в учня
 * три неоплачені уроки, він має отримати ОДНЕ повідомлення про борг, а не три.
 */

export const DEBT_MAX_REMINDERS = 4;
export const DEBT_INTERVAL_DAYS = 3;
/** Першу добу борг не чіпаємо: там ще може спрацювати нагадування за режимом
 *  репетитора («після уроку»), і два повідомлення поспіль виглядали б як збій. */
export const DEBT_FIRST_AFTER_DAYS = 1;
/* Лічильник обнуляється НЕ за часом, а за самим боргом: рахуємо лише ті
   нагадування, що новіші за початок найдавнішого неоплаченого уроку пари.
   Перша версія рахувала «за останні 30 днів» — і мій же тест показав, що
   борг, який ніхто не оплатив, після місяця тиші отримував ще чотири
   повідомлення, і так по колу. Рішення власниці було «максимум 4 рази», а не
   «4 рази на місяць довічно». Коли борг закривають і він набирається наново,
   найдавніший урок стає новішим — старі нагадування самі випадають із
   лічильника, і відлік чесно починається спочатку. */

const DAY_MS = 24 * 60 * 60 * 1000;

export type DebtDecision =
  | { send: false; reason: "too-fresh" | "too-soon" | "quota-spent" }
  | { send: true; kind: string; index: number };

/**
 * @param now             поточний час, мс
 * @param oldestDebtAtMs  початок НАЙДАВНІШОГО неоплаченого проведеного уроку пари
 * @param sentAtMs        коли вже слались нагадування про БОРГ цій парі (`debt_*`),
 *                        у мілісекундах — уся історія, фільтр усередині
 * @param lastOtherAtMs   коли цій парі востаннє йшла ІНША розмова ПРО ВЕСЬ БОРГ —
 *                        ручне «Нагадати» чи кнопка в Telegram (PAIR_WIDE_KINDS).
 *                        `null` — не було. Нагадування ЗА ОКРЕМИЙ УРОК («після
 *                        уроку», «до уроку», передоплата) сюди НЕ входять — їх
 *                        враховує buildDebtPairs, виключаючи сам урок (див. нижче).
 *
 * 22.09 (скан Lovable, підтверджено): прохід про борг не бачив нагадувань за
 * строком. Репетитор із режимом «після уроку» — і учень, чий урок пройшов
 * учора, отримував ДВА повідомлення про той самий неоплачений урок: «час
 * оплатити заняття» і одразу «є неоплачені уроки».
 *
 * 23.09 (скан Lovable, підтверджено — регресія правки 22.09): та правка глушила
 * прохід про борг на 3 дні після БУДЬ-ЯКОГО нагадування, включно з «після
 * уроку». Учень із двома уроками на тиждень отримує таке нагадування кожні
 * 3–4 дні — тож про СТАРІ неоплачені уроки йому не нагадали б ніколи, і
 * репетитор мовчки лишався б без цих грошей. Тепер правило точне:
 *  · урок, про який учню щойно (≤3 дні) писали «після/до уроку», з проходу про
 *    борг ВИКЛЮЧАЄТЬСЯ — два повідомлення про той самий урок неможливі;
 *  · якщо після виключення боргів не лишилось — мовчимо (випадок 22.09);
 *  · якщо лишились старіші — нагадуємо про борг, а інтервал тиші рахуємо від
 *    останньої розмови про ВЕСЬ борг (debt_*, ручне «Нагадати», кнопка Telegram).
 * Стеля «4 рази» рахує лише нагадування про борг.
 */
export function decideDebtReminder(
  now: number,
  oldestDebtAtMs: number,
  sentAtMs: readonly number[],
  lastOtherAtMs: number | null = null,
): DebtDecision {
  const recent = sentAtMs.filter((t) => t >= oldestDebtAtMs);

  if (recent.length >= DEBT_MAX_REMINDERS) {
    return { send: false, reason: "quota-spent" };
  }

  // Останнє нагадування БУДЬ-ЯКОГО виду — від нього й відраховуємо тишу.
  const candidates = [...recent];
  if (lastOtherAtMs !== null && Number.isFinite(lastOtherAtMs)) candidates.push(lastOtherAtMs);
  if (candidates.length > 0) {
    const last = Math.max(...candidates);
    if (now - last < DEBT_INTERVAL_DAYS * DAY_MS) {
      return { send: false, reason: "too-soon" };
    }
  }

  // Перше нагадування про борг — лише коли борг «дозрів».
  if (recent.length === 0 && now - oldestDebtAtMs < DEBT_FIRST_AFTER_DAYS * DAY_MS) {
    return { send: false, reason: "too-fresh" };
  }

  const index = recent.length + 1;
  return { send: true, kind: `debt_${index}`, index };
}

/** Усі види, які вміє писати цей механізм — рівно вони мусять бути дозволені
 *  CHECK-обмеженням таблиці `lesson_payment_reminders`. */
export const DEBT_KINDS: readonly string[] = Array.from(
  { length: DEBT_MAX_REMINDERS },
  (_, i) => `debt_${i + 1}`,
);

/** Розмови про ВЕСЬ борг пари: після них помічник мовчить DEBT_INTERVAL_DAYS. */
export const PAIR_WIDE_KINDS: readonly string[] = ["manual", "telegram_button"];
/** Нагадування за ОКРЕМИЙ урок: виключають лише цей урок із проходу про борг. */
export const PER_LESSON_KINDS: readonly string[] = ["before_lesson", "after_lesson", "prepaid"];

export type OtherReminderRow = { lesson_id: string | null; tutor_id: string; student_id: string; sent_at: string; reminder_kind: string };

/**
 * Історія «інших» нагадувань за інтервал тиші → (а) остання розмова про весь борг
 * по парі, (б) уроки, про які учню вже писали окремо (ключ `lesson:student`).
 */
export function splitOtherHistory(rows: readonly OtherReminderRow[]): {
  lastPairWideByPair: Map<string, number>;
  noticedLessons: Set<string>;
} {
  const lastPairWideByPair = new Map<string, number>();
  const noticedLessons = new Set<string>();
  for (const h of rows) {
    const at = new Date(h.sent_at).getTime();
    if (PAIR_WIDE_KINDS.includes(h.reminder_kind)) {
      const key = `${h.tutor_id}:${h.student_id}`;
      if (at > (lastPairWideByPair.get(key) ?? 0)) lastPairWideByPair.set(key, at);
    } else if (PER_LESSON_KINDS.includes(h.reminder_kind) && h.lesson_id) {
      noticedLessons.add(`${h.lesson_id}:${h.student_id}`);
    }
  }
  return { lastPairWideByPair, noticedLessons };
}

export type DebtRow = { tutor_id: string; student_id: string; lessonId: string; at: number; price: number };
export type DebtPair = {
  tutor_id: string;
  student_id: string;
  /** чесний баланс: УСІ неоплачені проведені уроки пари */
  total: number;
  count: number;
  oldestAt: number;
  oldestLesson: string;
  /** скільки з них НЕ згадувались учню окремо за інтервал тиші — про них і нагадуємо */
  chaseable: number;
};

/** Борги → пари. Один урок = одна згадка: урок, про який щойно писали окремо, не веде до другого повідомлення. */
export function buildDebtPairs(rows: readonly DebtRow[], noticedLessons: ReadonlySet<string>): Map<string, DebtPair> {
  const pairs = new Map<string, DebtPair>();
  for (const r of rows) {
    const key = `${r.tutor_id}:${r.student_id}`;
    const noticed = noticedLessons.has(`${r.lessonId}:${r.student_id}`);
    const cur = pairs.get(key);
    if (!cur) {
      pairs.set(key, { tutor_id: r.tutor_id, student_id: r.student_id, total: r.price, count: 1, oldestAt: r.at, oldestLesson: r.lessonId, chaseable: noticed ? 0 : 1 });
    } else {
      cur.total += r.price;
      cur.count += 1;
      if (!noticed) cur.chaseable += 1;
      if (r.at < cur.oldestAt) { cur.oldestAt = r.at; cur.oldestLesson = r.lessonId; }
    }
  }
  return pairs;
}
