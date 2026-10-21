// Привʼязка OAuth-потоку Google до браузера, який його почав (red team 20.10).
//
// Підписаний state доводить, ХТО почав потік (user_id), але не те, що згоду
// Google завершує той самий браузер. Тому крок «редірект на Google» кладе
// одноразовий nonce і в state, і в cookie саме цього браузера, видиму лише
// для шляху callback; callback приймає токени лише за збігу. Чужий браузер
// (жертва, якій надіслали адресу згоди) cookie не має — токени не пишуться.
//
// SameSite=Lax: cookie їде з top-level GET-навігацією з accounts.google.com
// назад на наш callback — саме те, що потрібно; у cross-site POST/iframe — ні.

export const OAUTH_COOKIE = "oth_oauth";
const CALLBACK_PATH = "/functions/v1/google-calendar-callback";
const MAX_AGE_SECONDS = 15 * 60;

export function oauthCookieHeader(nonce: string): string {
  return `${OAUTH_COOKIE}=${encodeURIComponent(nonce)}; Max-Age=${MAX_AGE_SECONDS}; Path=${CALLBACK_PATH}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearOauthCookieHeader(): string {
  return `${OAUTH_COOKIE}=; Max-Age=0; Path=${CALLBACK_PATH}; Secure; HttpOnly; SameSite=Lax`;
}

/** Значення cookie `oth_oauth` із заголовка Cookie або null. */
export function readOauthCookie(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== OAUTH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function nonceEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
