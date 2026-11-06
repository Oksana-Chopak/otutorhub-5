/* Ключ сторінки оплати — ОДНЕ визначення для всіх, хто його читає чи будує.
 *
 * 06.11, живий дефект: пакет 01.11 додав КОРОТКЕ посилання `/p/<8 знаків>` —
 * воно пішло і в аркуш «Нагадати», і в автоматичні нагадування. База його
 * розуміє (`payment_link_lookup` приймає `^[a-z0-9]{8}$` і `^[0-9a-f]{64}$`),
 * сторінка передає його edge-функції як є. А `pay-link` лишилась із перевіркою
 * «лише 64 hex» — тож КОЖНЕ коротке посилання відповідало «link not found»
 * ще до звернення до бази. Мама, що тапнула посилання з нагадування, бачила
 * порожнечу: ні боргу, ні реквізитів, ні кнопки «Я оплатила». І та сама
 * перевірка глушила POST, тобто сказати «я оплатила» теж було неможливо.
 *
 * Форм ключа дві, і вони мусять жити в одному місці, бо їх читають і
 * будують у чотирьох: `pay-link`, `_shared/paymentReminder`,
 * `payment-reminders` і SQL-функція `payment_link_lookup`. Три копії вже
 * розійшлись один раз.
 */

/** Короткий стабільний код пари: 8 знаків, малі літери й цифри. */
export const PAY_SHORT_RE = /^[a-z0-9]{8}$/;
/** Старий довгий токен: 64 hex (256 біт). Посилання з ним досі живі. */
export const PAY_TOKEN_RE = /^[0-9a-f]{64}$/;

/** Ключ із рядка запиту або тіла: будь-яка з двох форм, інакше null. */
export function payKey(raw: unknown): string | null {
  const t = String(raw ?? "").trim().toLowerCase();
  return PAY_SHORT_RE.test(t) || PAY_TOKEN_RE.test(t) ? t : null;
}

/** Адреса сторінки за ключем: короткий код → /p/, довгий токен → /pay/. */
export function payUrlFor(raw: unknown, appUrl: string): string {
  const base = appUrl.replace(/\/+$/, "");
  const t = String(raw ?? "").trim().toLowerCase();
  if (PAY_SHORT_RE.test(t)) return `${base}/p/${t}`;
  if (PAY_TOKEN_RE.test(t)) return `${base}/pay/${t}`;
  return "";
}
