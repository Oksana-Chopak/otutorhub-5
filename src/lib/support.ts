/**
 * Єдиний контакт підтримки на весь продукт (15.09).
 *
 * Скарга живого користувача: «Нет чата, где можно связаться с тобой? Как
 * support». Форма «Залишити фідбек» у застосунку вже була, але це ящик в ОДИН
 * бік: людина пише, відповіді не бачить — тому й питає про чат.
 *
 * Рішення власниці: Telegram. Один канал, нуль інфраструктури, відповідь із
 * телефона. Щоб посилання не розповзлось по файлах різними написаннями,
 * воно живе ТУТ одним рядком: змінити контакт = змінити одну константу.
 *
 * Поки username не заданий, кнопки підтримки не зникають — вони ведуть у
 * форму фідбеку (у застосунку) або на пошту (на лендінгу). Порожній канал
 * гірший за повільний.
 */
export const SUPPORT_TELEGRAM = "@oksana_chopak";

export const SUPPORT_EMAIL = "oksana.chopak@gmail.com";

/** Посилання на чат підтримки або null, якщо контакт ще не заданий. */
export function supportTelegramUrl(): string | null {
  const h = SUPPORT_TELEGRAM.trim().replace(/^@/, "");
  return h ? `https://t.me/${h}` : null;
}

/** Куди вести з лендінгу, де форми фідбеку немає: Telegram → пошта. */
export function supportFallbackUrl(subject: string): string {
  return supportTelegramUrl() ?? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
