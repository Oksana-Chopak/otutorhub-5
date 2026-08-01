/**
 * FINANCE INVARIANTS — модель хаба (НЕПОРУШНО):
 * учень платить хабу (student_price), хаб платить репетитору (tutor_payout),
 * маржа хаба = student_price − tutor_payout і В НОРМІ ДОДАТНА.
 *
 * Закріплено тестами src/test/hub-pricing-invariants.test.ts. Якщо тут щось
 * міняється — спершу онови бізнес-модель у CLAUDE.md і тести, свідомо.
 */
export const hubMargin = (studentPrice: number, tutorPayout: number): number =>
  (Number(studentPrice) || 0) - (Number(tutorPayout) || 0);

export const isNonPositiveMargin = (studentPrice: number, tutorPayout: number): boolean =>
  hubMargin(studentPrice, tutorPayout) <= 0;
