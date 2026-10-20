import type { QueryClient } from "@tanstack/react-query";

/** Ключ, під яким react-query тримає кеш у localStorage (App.tsx, офлайн D). */
export const RQ_PERSIST_KEY = "otutorhub.rq-cache.v1";

let registered: QueryClient | null = null;
/** App.tsx реєструє свій QueryClient, щоб «Вийти» міг очистити кеш без React-контексту. */
export function registerQueryClient(client: QueryClient): void {
  registered = client;
}

/**
 * Red team 20.10: після «Вийти» кеш react-query (учні, уроки, гроші) лишався в
 * localStorage на добу — на спільному компʼютері (школа, сімейний ноутбук)
 * наступна людина мала його ще до входу, а після входу під ІНШИМ акаунтом
 * запити без user_id у ключі могли показати чужі дані з кеша.
 * Вихід = чистий пристрій: кеш у памʼяті, його копія на диску, чернетки вкладки.
 * Мова й «запамʼятати мене» — не особисті дані, лишаються.
 */
export function purgeLocalCaches(): void {
  try { registered?.clear(); } catch { /* кеш у памʼяті — best-effort */ }
  try { window.localStorage.removeItem(RQ_PERSIST_KEY); } catch { /* приватний режим */ }
  try { window.sessionStorage.clear(); } catch { /* приватний режим */ }
}
