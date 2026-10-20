// Чистка вільного тексту, який наш домен розсилає від імені користувача
// (red team 20.10). Імʼя репетитора/учня й назви предметів потрапляють у
// ТЕМУ і тіло листа-запрошення; імʼя пише сам відправник — тому «Перейди на
// evil.example/приз» у полі імені перетворювало платформу на спам-ретранслятор.
// Посилання, домени й керівні символи з таких полів прибираємо, довжину ріжемо.

const URL_LIKE = /(https?:\/\/\S+|www\.\S+|\b[\w-]+(\.[\w-]+)+\b(\/\S*)?)/giu;
const CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g;

/** Імʼя людини: без посилань/доменів, один пробіл між словами, не довше `max`. */
export function cleanPersonName(value: unknown, max = 60): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(CONTROL, " ")
    .replace(URL_LIKE, " ")
    .replace(/[<>{}[\]|\\^`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned || undefined;
}

/** Список коротких підписів (предмети): кожен чистимо як імʼя, не більше `maxItems`. */
export function cleanLabels(values: unknown, maxItems = 5, maxLen = 40): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const c = cleanPersonName(v, maxLen);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= maxItems) break;
  }
  return out;
}
