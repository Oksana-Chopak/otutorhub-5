/**
 * ОДИН ЗАПИТ ЗАМІСТЬ КІЛЬКОХ ОДНАКОВИХ (17.11, вимір навантаження).
 *
 * Той самий хук стоїть у кількох місцях оболонки одразу (бічне меню, нижня навігація, шапка для
 * телефона і для компʼютера), і кожен екземпляр робив ВЛАСНИЙ запит: на кожне відкриття
 * застосунку `is_superadmin` летів 3–5 разів, список чатів — тричі, сповіщення — двічі. Для бази
 * це ті самі рядки, прочитані кілька разів; для людини — нічого.
 *
 * `coalesce(key, fn)` — поки запит із цим ключем летить, усі охочі чекають на ту саму відповідь.
 * `ttlMs` — ще й памʼятає відповідь стільки мілісекунд (лише для того, що не міняється щохвилини).
 * Ключ ОБОВʼЯЗКОВО містить id людини: відповідь одного користувача ніколи не дістанеться іншому.
 */
const inflight = new Map<string, Promise<unknown>>();
const remembered = new Map<string, { at: number; value: unknown }>();

export function coalesce<T>(key: string, fn: () => PromiseLike<T>, ttlMs = 0): Promise<T> {
  if (ttlMs > 0) {
    const hit = remembered.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
  }
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = Promise.resolve(fn())
    .then((v) => { if (ttlMs > 0) remembered.set(key, { at: Date.now(), value: v }); return v; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/** Забути запамʼятоване (вихід з акаунта, тести). */
export function forgetCoalesced(): void {
  inflight.clear();
  remembered.clear();
}
