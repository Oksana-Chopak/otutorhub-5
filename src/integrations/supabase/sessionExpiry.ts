/**
 * Коли сесія тихо закінчилась — сказати про це, а не показати порожній екран.
 *
 * Скан 16.09 на живих логах: «розклад і профіль репетитора відповідають
 * permission denied рівно в ті моменти, коли оновлення токена впирається в
 * ліміт». Це і є картина протухлої сесії: браузер далі ходить у базу зі
 * старим токеном, PostgREST відповідає 401, сторінка ловить помилку й
 * малює порожньо. Людина бачить не «увійдіть ще раз», а зламаний розклад —
 * і думає, що зникли її уроки.
 *
 * Тому: один спільний сигнал. Його піднімає обгортка fetch (єдине місце, крізь
 * яке йдуть УСІ запити Supabase), а ловить AuthProvider — чистить стан,
 * показує тост і віддає людину на сторінку входу, звідки ProtectedRoute
 * поверне її туди, де вона була.
 *
 * Свідомі межі:
 *  · лише 401 і лише на /rest/v1/ та /functions/v1/. Відповіді /auth/v1/ не
 *    чіпаємо взагалі — там 401 означає «невірний пароль», і вигнати людину
 *    з форми входу за спробу входу було б безглуздо;
 *  · сигнал не піднімається, якщо збереженого токена немає: анонімний запит,
 *    якому чесно відмовили, — не протухла сесія;
 *  · не частіше разу на 30 секунд: один протухлий токен валить десяток
 *    паралельних запитів, а тост і редірект потрібні рівно один.
 */

type Handler = () => void;

let handler: Handler | null = null;
let lastFiredAt = 0;

const QUIET_MS = 30_000;

/** Підписатися на «сесія протухла». Повертає відписку. */
export function onSessionExpired(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** Підняти сигнал (з приглушенням). */
export function reportSessionExpired(): void {
  const now = Date.now();
  if (now - lastFiredAt < QUIET_MS) return;
  lastFiredAt = now;
  handler?.();
}

/** Після успішного входу приглушення скидається — наступний збій має звучати. */
export function resetSessionExpiry(): void {
  lastFiredAt = 0;
}

/** Чи є в цьому браузері збережений токен Supabase. */
export function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) return true;
    }
  } catch {
    /* приватний режим — вважаємо, що сесії немає */
  }
  return false;
}

/** Чи схожа ця відповідь на «твій токен більше не дійсний». */
export function looksLikeExpiredSession(url: string, status: number): boolean {
  if (status !== 401) return false;
  if (url.includes("/auth/v1/")) return false;
  return url.includes("/rest/v1/") || url.includes("/functions/v1/");
}

/**
 * 23.09 (скан Lovable: «розклад і профіль падають з permission denied рівно
 * тоді, коли оновлення токена впирається в ліміт»). Що відбувається насправді:
 * supabase-js на 429 від /auth/v1/token вважає оновлення НЕВДАЛИМ, стирає сесію
 * зі сховища і шле SIGNED_OUT; наступні запити йдуть з анонімним ключем → база
 * відповідає «permission denied» → людина, яка нічого не робила, опиняється на
 * сторінці входу. Ліміт — тимчасовий (5 хв на IP; мобільні оператори ховають
 * тисячі людей за однією адресою), а сесію втрачено назавжди.
 *
 * Тому: збій оновлення, який виглядає тимчасовим (429, мережа, 5xx), — НЕ
 * «сесія протухла». Спершу одна-дві тихі спроби відновити сесію тим самим
 * refresh-токеном (сервер його не обертав, бо відмовив ДО обробки), і лише
 * якщо не вийшло — вхід заново, з поверненням на ту саму сторінку.
 */
export const RESTORE_DELAYS_MS: readonly number[] = [5_000, 30_000];

/** Чи схожа помилка оновлення токена на ТИМЧАСОВУ (ліміт запитів, мережа, 5xx)? */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; name?: string; code?: string; message?: string };
  if (e.status === 429 || e.code === "over_request_rate_limit") return true;
  if (e.name === "AuthRetryableFetchError") return true;
  if (typeof e.status === "number" && e.status >= 500) return true;
  if (e.status === 0 || /fetch failed|network|Failed to fetch/i.test(e.message ?? "")) return true;
  return false;
}
