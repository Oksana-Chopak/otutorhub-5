// Привʼязка запису Fireflies до уроку (red team 20.10, знахідка H1).
//
// Було: назва зустрічі для бота = довільний `title` із тіла запиту або
// `Tutoring: <предмет> [<lessonId>]`, а вебхук знаходив урок регуляркою
// `[<uuid>]` у назві. Отже будь-який репетитор міг записати СВОЮ зустріч із
// назвою `x [<uuid чужого уроку>]` — і транскрипт лягав у чужий урок зі
// сповіщенням «конспект готовий» чужому репетитору.
//
// Тепер назву генерує лише сервер: `oTutorHub [<lessonId>.<тег>]`, де тег —
// HMAC-SHA256 від lessonId на секреті вебхука (`FIREFLIES_WEBHOOK_SECRET`, він
// уже є в обох функцій). Вебхук приймає lessonId із назви ЛИШЕ з правильним
// тегом. Підробити тег без секрету не можна; схема бази не змінюється.
const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 16 hex-символів тегу вистачає: підбір 2^64 варіантів через Fireflies неможливий. */
const TAG_LEN = 16;

export async function firefliesTitleFor(lessonId: string, secret: string): Promise<string> {
  const tag = (await hmacHex(secret, lessonId)).slice(0, TAG_LEN);
  return `oTutorHub [${lessonId}.${tag}]`;
}

const BOUND_RE = /\[([0-9a-f-]{36})\.([0-9a-f]{16})\]/i;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** lessonId з назви зустрічі — лише якщо тег справжній; інакше null. */
export async function lessonIdFromTitle(title: string | null | undefined, secret: string): Promise<string | null> {
  if (typeof title !== "string") return null;
  const m = title.match(BOUND_RE);
  if (!m) return null;
  const lessonId = m[1].toLowerCase();
  const expected = (await hmacHex(secret, lessonId)).slice(0, TAG_LEN);
  return safeEqual(m[2].toLowerCase(), expected) ? lessonId : null;
}

/** Старий формат `[<uuid>]` без тегу — для записів, запущених ДО цього деплою. */
export function legacyLessonIdFromTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string") return null;
  if (BOUND_RE.test(title)) return null;
  const m = title.match(/\[([0-9a-f-]{36})\]/i);
  return m ? m[1].toLowerCase() : null;
}
