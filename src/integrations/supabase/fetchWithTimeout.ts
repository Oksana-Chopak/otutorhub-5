// B7: у метро запит не падає — він ЗАВИСАЄ: спінер крутиться, busy=true,
// кнопка мертва, і жоден catch не спрацьовує, бо помилки немає взагалі.
// Обгортка додає кожному запиту Supabase таймаут 15с і тихий бекоф-ретрай
// для ІДЕМПОТЕНТНИХ читань (GET/HEAD). Мутації не ретраяться ніколи —
// повторний POST міг би записати оплату двічі.
//
// 26.09 — та сама обгортка тепер ретраїть і ВІДПОВІДІ «спробуй пізніше»
// (429 «забагато запитів», 5xx), не лише кинуті помилки мережі. Причина не
// теоретична: скан живих логів 16.09 — «розклад і профіль репетитора
// відповідають permission denied рівно в ті моменти, коли оновлення токена
// впирається в ліміт», а ліміт Supabase рахується НА IP: мобільний оператор і
// шкільний Wi-Fi ховають за однією адресою сотні людей. Для людини це
// виглядало як «Не вдалося завантажити» на грошах або вічний спінер при вході,
// хоча дані цілі, а відмова тимчасова (секунди). Один тихий повтор читання
// прибирає цілий клас таких «зламаних екранів».
//
// Межі свідомі:
//  · /auth/v1/ не ретраїмо взагалі — там 429 обробляє сам supabase-js разом із
//    тихим відновленням сесії (sessionExpiry.RESTORE_DELAYS_MS), а зайвий стук
//    у token-ендпойнт лише поглибив би ліміт;
//  · лише GET/HEAD: повторити POST оплати не можна;
//  · пауза чекає Retry-After, але не довше PAUSE_CAP_MS — людина краще побачить
//    чесну помилку, ніж застиглий екран на 30 секунд.

import { hasStoredSession, looksLikeExpiredSession, reportSessionExpired } from "./sessionExpiry";

const TIMEOUT_MS = 15_000;
const READ_ATTEMPTS = 3; // 1 спроба + 2 ретраї з бекофом 400мс/800мс
const PAUSE_CAP_MS = 2_000;

/** Чи варто повторити ідемпотентне читання після ТАКОЇ відповіді сервера. */
export function isRetryableReadStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 500;
}

/** Скільки чекати: Retry-After (секунди або дата), інакше бекоф; не більше стелі. */
export function retryPauseMs(retryAfter: string | null, attempt: number): number {
  const backoff = 400 * 2 ** attempt;
  if (!retryAfter) return Math.min(backoff, PAUSE_CAP_MS);
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, PAUSE_CAP_MS);
  const at = Date.parse(retryAfter);
  if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), PAUSE_CAP_MS);
  return Math.min(backoff, PAUSE_CAP_MS);
}

export const fetchWithTimeout: typeof fetch = async (input, init) => {
  const method = (
    init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const isAuth = url.includes("/auth/v1/");
  const attempts = (method === "GET" || method === "HEAD") && !isAuth ? READ_ATTEMPTS : 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      const res = await fetch(input, { ...init, signal });
      // 16.09: єдине місце, крізь яке йдуть УСІ запити Supabase — отже єдине
      // чесне місце, щоб помітити протухлу сесію. Тіло відповіді не чіпаємо:
      // його читає той, хто викликав. Деталі меж — у sessionExpiry.ts.
      if (looksLikeExpiredSession(url, res.status) && hasStoredSession()) reportSessionExpired();
      // «Спробуй пізніше» — це не дані. Поки є спроби, чекаємо і повторюємо;
      // на останній віддаємо відповідь як є, щоб викликач показав помилку.
      if (isRetryableReadStatus(res.status) && attempt < attempts - 1 && !init?.signal?.aborted) {
        await new Promise((r) => setTimeout(r, retryPauseMs(res.headers.get("retry-after"), attempt)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // Викликач сам скасував (розмонтування, зміна фільтра) — не ретраїмо.
      if (init?.signal?.aborted) throw e;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
};
