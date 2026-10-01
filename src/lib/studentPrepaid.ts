/**
 * Передоплата учня в УРОКАХ — одна чиста функція, бо від неї залежить головна
 * картка «що далі» на дашборді учня.
 *
 * Блокер Б1 (аудит 01.10): до цього баланс рахувався як кількість `scheduled`
 * уроків із уже прочитаного списку, причому порівняння йшло по полю
 * `student_id`, якого в тому `select` НЕ БУЛО. Тобто баланс завжди виходив 0, і
 * картка «що далі» ЗАВЖДИ казала «Передоплата вичерпана — поповни» — кожному
 * учневі, щодня, навіть коли він нічого не винен. А стани під нею («Наступний
 * урок», «Серію перервано», «Розклад порожній») ставали недосяжними: головний
 * екран учня ніколи не показував того, по що він його відкриває.
 *
 * Два правила, які тут закріплені:
 *  1. **Немає передоплати в уроках — немає числа.** Пара з ГРОШОВИМ гаманцем
 *     має `lessons_balance = 0`, і сказати їй «уроки закінчились» означало б
 *     вигадати факт. Ознака «передоплата ведеться в уроках» — хоч одне
 *     поповнення з `lessons_delta > 0` у цій парі.
 *  2. **«Не прочитав» ≠ «нуль».** Збій читання повертає `null`, а не 0:
 *     інакше тимчасова помилка мережі малює учневі вимогу грошей.
 */

export interface PrepaidWalletRow {
  tutor_id: string | null;
  lessons_balance: number | null;
}

/** Пари, у яких колись було поповнення САМЕ в уроках. */
export interface PrepaidTopupRow {
  tutor_id: string | null;
}

/**
 * @returns кількість передплачених уроків, або `null` коли попереджати нічим:
 *          передоплати в уроках у цього учня немає взагалі, або читання впало.
 */
export function prepaidLessonBalance(args: {
  wallets: PrepaidWalletRow[] | null | undefined;
  lessonTopups: PrepaidTopupRow[] | null | undefined;
  readFailed?: boolean;
}): number | null {
  if (args.readFailed) return null;
  const pairs = new Set(
    (args.lessonTopups ?? []).map((t) => t.tutor_id).filter((id): id is string => !!id),
  );
  if (pairs.size === 0) return null;
  return (args.wallets ?? [])
    .filter((w) => w.tutor_id && pairs.has(w.tutor_id))
    .reduce((sum, w) => sum + Number(w.lessons_balance ?? 0), 0);
}
