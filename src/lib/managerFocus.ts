/**
 * «Мій день» менеджера починається з грошей і людей (21.11, рішення власниці п. 3).
 *
 * Список «Що зробити далі» в менеджера був, але під цифрами — на другому екрані. Тепер
 * зверху одна картка: найтерміновіше в грошах і людях, з однією дією. Порядок — словами
 * власниці: кому нагадати про борг → учень без репетитора → нова заявка. (Заявка «я оплатив»
 * ще вище: вона стоїть окремою карткою, бо гроші вже прийшли й чекають лише підтвердження.)
 *
 * Борг, про який нагадували за останні 3 доби, головною дією не стає: людині вже нагадали,
 * повторне «Нагадати» зверху екрана — це тиснути на батьків, а не вести менеджера.
 */
export type FocusTask = {
  key: string;
  remindPair?: { studentId: string; tutorId: string } | null;
};

/** Префікси ключів задач у порядку терміновості. */
export const MANAGER_FOCUS_ORDER = ["debtor-", "students-no-tutor", "school-lead-", "tutor-referral-requests"] as const;

/** Скільки після нагадування борг не стає головною дією. */
export const FOCUS_REMIND_COOLDOWN_MS = 72 * 3600_000;

export function remindedWithin(lastIso: string | null | undefined, nowMs: number, windowMs = FOCUS_REMIND_COOLDOWN_MS): boolean {
  if (!lastIso) return false;
  const t = new Date(lastIso).getTime();
  return Number.isFinite(t) && nowMs - t < windowMs;
}

/** Одна головна задача менеджера або null (тоді «Мій день» починається з дня школи). */
export function pickManagerFocus<T extends FocusTask>(
  tasks: T[],
  remindedRecently: (pair: { studentId: string; tutorId: string }) => boolean,
): T | null {
  for (const prefix of MANAGER_FOCUS_ORDER) {
    const hit = tasks.find((t) => t.key.startsWith(prefix) && !(t.remindPair && remindedRecently(t.remindPair)));
    if (hit) return hit;
  }
  return null;
}
