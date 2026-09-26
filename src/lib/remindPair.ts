/**
 * ОДНЕ нагадування на ЛЮДИНУ — і п'ять секунд, щоб передумати (важіль 2
 * аудиту шляхів 24.09).
 *
 * Чому так, а не «надіслати одразу»:
 *  · борг людини лежить на кількох уроках, а розмова з нею одна. Три
 *    повідомлення про три уроки вчать її їх не читати — тому edge-функція
 *    `remind-payment` у режимі пари шле ОДНЕ повідомлення про весь борг;
 *  · «Скасувати» в тості мусить справді скасовувати. Надіслане в Telegram
 *    повідомлення не відкликається, отже єдиний честний спосіб — коротка
 *    затримка ПЕРЕД відправкою. 5 секунд: достатньо, щоб зловити випадковий
 *    дотик, і непомітно для того, хто справді хотів нагадати.
 *
 * Таймер живе НА МОДУЛІ, а не в компоненті: людина тисне «Нагадати» і
 * перемикає екран — нагадування все одно має піти. І навпаки: поки воно ще не
 * пішло, повторний дотик по тій самій парі не створює другого.
 */

export type RemindKey = string;

/** Ключ пари. Порожній tutorId = «я сам» (репетитор нагадує про свого учня). */
export function remindKey(studentId: string, tutorId?: string | null): RemindKey {
  return `${tutorId ?? "me"}:${studentId}`;
}

type Pending = { timer: ReturnType<typeof setTimeout>; at: number };
const pending = new Map<RemindKey, Pending>();

export const REMIND_DELAY_MS = 5_000;

/** Чи нагадування по цій парі вже стоїть у черзі (і ще не пішло). */
export function isRemindPending(key: RemindKey): boolean {
  return pending.has(key);
}

/**
 * Поставити нагадування в чергу. Повертає функцію скасування; вона ж
 * викликається, якщо по тій самій парі приходить новий запит (другий дотик
 * не створює другого нагадування).
 */
export function scheduleRemind(
  key: RemindKey,
  send: () => void | Promise<void>,
  delayMs: number = REMIND_DELAY_MS,
): () => void {
  cancelRemind(key);
  const timer = setTimeout(() => {
    pending.delete(key);
    void send();
  }, delayMs);
  pending.set(key, { timer, at: Date.now() });
  return () => cancelRemind(key);
}

/** Скасувати нагадування, яке ще не пішло. true — встигли. */
export function cancelRemind(key: RemindKey): boolean {
  const p = pending.get(key);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(key);
  return true;
}

/** Лише для тестів: прибрати всі черги. */
export function __resetRemindQueue(): void {
  for (const [, p] of pending) clearTimeout(p.timer);
  pending.clear();
}
