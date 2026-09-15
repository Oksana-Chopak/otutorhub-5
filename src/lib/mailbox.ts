/**
 * Куди людині йти читати лист, який ми щойно надіслали.
 *
 * Скарга власниці (14.09) на фінальний крок анкети підбору: екран каже
 * «перевірте пошту», і на цьому все — «А кнопку-редірект поставити можна?».
 * На телефоні це і справді глухий кут: людина має згорнути браузер, знайти
 * застосунок пошти, знайти лист. Кожен зайвий крок тут — це втрачений лід.
 *
 * Універсального «відкрий мою скриньку» в вебі не існує: `mailto:` створює
 * НОВИЙ лист, а не відкриває вхідні. Єдиний чесний спосіб — знати адресу
 * веб-пошти конкретного провайдера. На мобільних ці адреси відкриваються
 * рідним застосунком (Gmail, Outlook, Пошта), бо провайдери самі ставлять
 * universal links / app links на власні домени.
 *
 * Тому: знаємо провайдера — даємо кнопку з його імʼям («Відкрити Gmail»).
 * Не знаємо — НЕ показуємо кнопку взагалі. Кнопка «Відкрити пошту», яка веде
 * в нікуди або створює порожній лист, гірша за її відсутність (інваріант
 * «відсутнє рендериться як відсутнє»).
 */

type Provider = { label: string; url: string };

/* Точні домени. Ключі — у нижньому регістрі. */
const EXACT: Record<string, Provider> = {
  "gmail.com": { label: "Gmail", url: "https://mail.google.com/mail/u/0/" },
  "googlemail.com": { label: "Gmail", url: "https://mail.google.com/mail/u/0/" },
  "ukr.net": { label: "Ukr.net", url: "https://mail.ukr.net/desktop" },
  "i.ua": { label: "i.ua", url: "https://mail.i.ua" },
  "meta.ua": { label: "Meta.ua", url: "https://mail.meta.ua" },
  "icloud.com": { label: "iCloud Mail", url: "https://www.icloud.com/mail" },
  "me.com": { label: "iCloud Mail", url: "https://www.icloud.com/mail" },
  "mac.com": { label: "iCloud Mail", url: "https://www.icloud.com/mail" },
  "proton.me": { label: "Proton Mail", url: "https://mail.proton.me" },
  "protonmail.com": { label: "Proton Mail", url: "https://mail.proton.me" },
  "pm.me": { label: "Proton Mail", url: "https://mail.proton.me" },
  "zoho.com": { label: "Zoho Mail", url: "https://mail.zoho.com" },
  "gmx.net": { label: "GMX", url: "https://www.gmx.net" },
  "gmx.de": { label: "GMX", url: "https://www.gmx.net" },
  "telia.com": { label: "Telia", url: "https://webmail.telia.com" },
};

/* Родини доменів: outlook.com, hotmail.se, live.se, yahoo.co.uk — одна скринька. */
const FAMILIES: { test: (d: string) => boolean; provider: Provider }[] = [
  {
    test: (d) => /^(outlook|hotmail|live|msn)\./.test(d),
    provider: { label: "Outlook", url: "https://outlook.live.com/mail/0/" },
  },
  {
    test: (d) => /^(yahoo|ymail|rocketmail)\./.test(d),
    provider: { label: "Yahoo Mail", url: "https://mail.yahoo.com" },
  },
];

/**
 * Веб-пошта для адреси або `null`, якщо провайдер незнайомий.
 * Домен беремо після ОСТАННЬОЇ «@» — так «a@b@gmail.com» не обманює перевірку.
 */
export function mailboxFor(email: string): Provider | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.trim().toLowerCase().slice(at + 1);
  if (!domain || domain.includes(" ")) return null;
  if (EXACT[domain]) return EXACT[domain];
  for (const f of FAMILIES) if (f.test(domain)) return f.provider;
  return null;
}
