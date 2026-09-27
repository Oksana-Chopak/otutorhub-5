/**
 * Гроші тижневого дайджесту — ЧИСТА математика, щоб її можна було перевірити
 * тестом (у самій edge-функції імпорти з esm.sh, тож вона не тестується).
 *
 * Причина існування (аудит 18.09, підтверджено 27.09): «Зароблено» в
 * `tutor-weekly-digest` рахувалось як сума цін УСІХ проведених уроків — разом
 * із неоплаченими. Ті самі гроші нижче зʼявлялись ще раз як «борги учнів», тож
 * тиждень виглядав удвічі прибутковішим. А ХАБОВОМУ репетитору показувалась
 * ціна учня — виручка ШКОЛИ й витік її маржі — замість його власної виплати
 * (той самий клас, що закритий у ранковому дайджесті 22.09).
 *
 * Правило: «зароблено» = ОТРИМАНЕ. Самостійному — оплачені ціни його учнів,
 * хабовому — його виплачені виплати. Ніколи навпаки.
 */

export interface DigestDetails {
  student_price?: number | null;
  student_payment_status?: string | null;
  tutor_payout?: number | null;
  tutor_payout_status?: string | null;
}

export interface DigestLesson {
  lesson_details?: DigestDetails | DigestDetails[] | null;
}

/**
 * PostgREST віддає вкладений рядок то обʼєктом, то масивом (залежно від того,
 * чи звʼязок вважається «to-many»). Читати лише обʼєкт — тиха нуль-сума.
 */
export function detailsOf(l: DigestLesson): DigestDetails | null {
  const d = l?.lesson_details;
  if (!d) return null;
  return Array.isArray(d) ? (d[0] ?? null) : d;
}

const sum = (rows: DigestLesson[], pick: (d: DigestDetails) => number) =>
  rows.reduce((s, l) => {
    const d = detailsOf(l);
    return d ? s + (Number(pick(d)) || 0) : s;
  }, 0);

/** Гроші, які учні СПРАВДІ заплатили (для самостійного і для школи). */
export function paidStudentIncome(rows: DigestLesson[]): number {
  return sum(rows.filter((l) => detailsOf(l)?.student_payment_status === "paid"),
    (d) => Number(d.student_price ?? 0));
}

/** Виплати, які репетитор СПРАВДІ отримав. */
export function paidTutorPayout(rows: DigestLesson[]): number {
  return sum(rows.filter((l) => detailsOf(l)?.tutor_payout_status === "paid"),
    (d) => Number(d.tutor_payout ?? 0));
}

/** Виплати, які школа ще винна репетитору. */
export function unpaidTutorPayout(rows: DigestLesson[]): number {
  return sum(rows.filter((l) => detailsOf(l)?.tutor_payout_status === "unpaid"),
    (d) => Number(d.tutor_payout ?? 0));
}

/** Борг учнів перед тим, хто отримує гроші (ціни неоплачених уроків). */
export function unpaidStudentDebt(rows: DigestLesson[]): number {
  return sum(rows, (d) => Number(d.student_price ?? 0));
}
