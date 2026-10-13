/**
 * Магічне посилання на публічну сторінку оплати (13.10, пре-мортем).
 *
 * Навіщо: автоматичне нагадування доходило лише до учня з акаунтом і Telegram
 * (або поштою). Батьки живуть у Viber/Telegram і нічого не встановлюють, тож
 * головна обіцянка продукту «ви не нагадуєте» не працювала з першого дня для
 * більшості репетиторів. Посилання веде на сторінку БЕЗ входу: борг, реквізити,
 * кнопка «Я оплатив(ла)» → заявка, яку репетитор підтверджує одним дотиком.
 *
 * Тут — чиста логіка: адреса сторінки, текст для пересилання, адреси
 * «поділитися» для месенджерів. Жодних запитів до бази.
 */

export interface PayLinkIssue {
  token: string;
  lessons: number;
  total: number;
  currency: string;
  telegram: boolean;
  email: boolean;
  has_requisites?: boolean;
  student_first_name: string;
  tutor_name: string;
}

export type ShareTarget = "telegram" | "viber" | "whatsapp" | "sms";

/** Публічна адреса сторінки оплати. `origin` — без слешу в кінці. */
export function payLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/pay/${token}`;
}

/** Текст для пересилання — коротко, по-людськи, з посиланням останнім рядком. */
export function buildShareText(opts: {
  studentFirstName: string;
  tutorName: string;
  lessons: number;
  total: number;
  currencySymbol: string;
  url: string;
  t: (key: string, vars?: Record<string, unknown>) => string;
}): string {
  const { studentFirstName, tutorName, lessons, total, currencySymbol, url, t } = opts;
  const greet = studentFirstName ? t("payLink.shareGreet", { name: studentFirstName }) : t("payLink.shareGreetNoName");
  const body = total > 0
    ? t("payLink.shareBody", { count: lessons, sum: `${Math.round(total)} ${currencySymbol}` })
    : t("payLink.shareBodyNoSum", { count: lessons });
  const who = tutorName ? t("payLink.shareFrom", { tutor: tutorName }) : "";
  return [greet, body, who, t("payLink.shareLinkLine"), url].filter(Boolean).join("\n");
}

/** Адреси «поділитися» для месенджерів телефону. */
export function shareHref(target: ShareTarget, text: string): string {
  const enc = encodeURIComponent(text);
  switch (target) {
    case "telegram": {
      // t.me/share/url хоче ОКРЕМО url і text; посилання — останній рядок тексту.
      const lines = text.split("\n");
      const url = lines[lines.length - 1];
      const rest = lines.slice(0, -1).join("\n");
      return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(rest)}`;
    }
    case "viber":
      return `viber://forward?text=${enc}`;
    case "whatsapp":
      return `https://wa.me/?text=${enc}`;
    case "sms":
      return `sms:?&body=${enc}`;
  }
}

/** Чи телефон/браузер уміє системне «поділитися». */
export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as { share?: unknown }).share === "function";
}
