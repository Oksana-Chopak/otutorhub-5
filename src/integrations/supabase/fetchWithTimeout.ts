// B7: у метро запит не падає — він ЗАВИСАЄ: спінер крутиться, busy=true,
// кнопка мертва, і жоден catch не спрацьовує, бо помилки немає взагалі.
// Обгортка додає кожному запиту Supabase таймаут 15с і тихий бекоф-ретрай
// для ІДЕМПОТЕНТНИХ читань (GET/HEAD). Мутації не ретраяться ніколи —
// повторний POST міг би записати оплату двічі.

const TIMEOUT_MS = 15_000;
const READ_ATTEMPTS = 3; // 1 спроба + 2 ретраї з бекофом 400мс/800мс

export const fetchWithTimeout: typeof fetch = async (input, init) => {
  const method = (
    init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const attempts = method === "GET" || method === "HEAD" ? READ_ATTEMPTS : 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      return await fetch(input, { ...init, signal });
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
