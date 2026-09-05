/**
 * Імпорт учнів «встав список текстом» (рішення власниці 05.09, премортем п.2:
 * «ага» не наставало, бо цінність вимагала пів години ручної міграції з зошита).
 *
 * Парсер СВІДОМО детермінований, без AI: миттєво, офлайн, приватно (список
 * дітей з телефонами не літає в жодну модель), а помилки видно в превʼю до
 * створення. Фото зошита з AI-розбором — окремий етап (v2).
 *
 * Підтримувані рядки (роздільники: — – - , ; | таб):
 *   «Марія Коваль — математика — 500»
 *   «Іван; англійська; 400 грн»
 *   «Оля Петренко, 350»          → без предмета
 *   «Петро - фізика»             → без ціни
 *   «Соломія»                    → лише імʼя
 *   «Марк Іваненко 600»          → без роздільників: хвостове число = ціна
 * Ціна: чисте число, «грн»/«₴»/uah поруч — зрізаються. Порожні рядки і
 * рядки-заголовки («Імʼя предмет ціна») пропускаються мовчки.
 */

export interface ParsedStudent {
  /** Оригінальний рядок — показуємо в превʼю при помилці. */
  raw: string;
  firstName: string;
  lastName: string;
  subject: string | null;
  price: number | null;
  /** Людською мовою, чому рядок не буде імпортовано (null = ок). */
  error: "empty_name" | null;
}

const SEPARATORS = /[—–;|\t]|(?:\s-\s)|,/g;
const PRICE_RE = /^\s*(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:грн|uah|₴)?\s*$/i;
const TRAILING_PRICE_RE = /\s+(\d{2,6})\s*(?:грн|uah|₴)?\s*$/i;

const HEADER_WORDS = new Set([
  "імя", "ім'я", "имя", "name", "предмет", "subject", "ціна", "цена", "price", "учень", "учні",
]);

function looksLikeHeader(line: string): boolean {
  // Апострофи бувають різні (' ʼ ’ `) — «Імʼя» в заголовку має ловитись усіма.
  const words = line
    .toLowerCase()
    .replace(/['ʼ’`]/g, "")
    .replace(/[^a-zа-яіїєґ ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((w) => HEADER_WORDS.has(w));
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  // Перше слово — імʼя, решта — прізвище (по-батькові теж туди: краще в
  // прізвищі, ніж загублене).
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function parseStudentLine(rawLine: string): ParsedStudent | null {
  const raw = rawLine.trim();
  if (!raw) return null;
  if (looksLikeHeader(raw)) return null;

  // Нумерація списку («1. Марія», «2) Іван») — зрізаємо.
  const line = raw.replace(/^\s*\d{1,3}\s*[.)]\s*/, "");

  const tokens = line
    .split(SEPARATORS)
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length > 0);

  let name = "";
  let subject: string | null = null;
  let price: number | null = null;

  if (tokens.length <= 1) {
    // Без роздільників: «Марк Іваненко 600» / «Соломія».
    let rest = tokens[0] ?? "";
    const m = TRAILING_PRICE_RE.exec(rest);
    if (m) {
      price = Number(m[1].replace(",", "."));
      rest = rest.slice(0, m.index).trim();
    }
    name = rest;
  } else {
    name = tokens[0];
    for (const tok of tokens.slice(1)) {
      const m = PRICE_RE.exec(tok);
      if (m && price === null) {
        price = Number(m[1].replace(",", "."));
      } else if (subject === null) {
        subject = tok;
      }
      // Зайві токени після предмета й ціни ігноруємо (телефони/нотатки — у
      // картці учня руками; імпорт тримаємо передбачуваним).
    }
  }

  const { firstName, lastName } = splitName(name);
  return {
    raw,
    firstName,
    lastName,
    subject,
    price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
    error: firstName ? null : "empty_name",
  };
}

export function parseStudentList(text: string): ParsedStudent[] {
  return text
    .split(/\r?\n/)
    .map(parseStudentLine)
    .filter((r): r is ParsedStudent => r !== null);
}
