import { lazy, type ComponentType } from "react";

/**
 * ЛІНИВА СТОРІНКА, ЩО ПЕРЕЖИВАЄ ПУБЛІКАЦІЮ (08.11).
 *
 * Клас помилки з журналу: «Cannot read properties of undefined (reading
 * 'default')» на /dashboard. Саме так падає `React.lazy`, коли чанк сторінки
 * НЕ завантажився: React читає `.default` того, що повернув import(), а там
 * порожньо. А не завантажується він з однієї буденної причини — ми щойно
 * опублікували нову версію. У людини з відкритою вкладкою стара `index.html`
 * просить файл зі старим хешем, якого на сервері вже немає; перехід між
 * сторінками дає білий екран або «щось пішло не так».
 *
 * Для продукту, який оновлюється часто, це не рідкість, а правило: КОЖНА
 * публікація ламає екран кожному, хто в цей момент усередині. Людина не знає,
 * що треба оновити сторінку, — вона просто йде.
 *
 * Тому: чанк не завантажився → один раз перезавантажуємо сторінку, і людина
 * опиняється на новій версії. Один раз: мітка в sessionStorage не дає піти в
 * коло, якщо чанка немає з іншої причини (тоді помилка йде далі, як і була, —
 * краще чесна помилка, ніж вічне перезавантаження).
 */
const RELOAD_KEY = "otutorhub_chunk_reload";
/** Повторний збій протягом цього вікна — це вже не «нова версія». */
export const RELOAD_GUARD_MS = 30_000;

/** Чи можна перезавантажитись зараз (і позначити, що ми це зробили). */
export function allowChunkReload(now: number = Date.now()): boolean {
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0; } catch { /* приватний режим */ }
  if (now - last < RELOAD_GUARD_MS) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(now)); } catch { /* приватний режим */ }
  return true;
}

export type PageModule<T> = { default: T };

/** Те саме, що React.lazy, але з лікуванням «чанк зник після публікації». */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<PageModule<T>>) {
  return lazy(async () => {
    try {
      const mod = await load();
      // Порожній модуль — той самий збій, лише тихіший: React однаково впаде
      // на `.default`, але вже без шансу зрозуміти причину.
      if (!mod || typeof (mod as PageModule<T>).default === "undefined") {
        throw new Error("chunk loaded empty");
      }
      return mod;
    } catch (err) {
      if (typeof window !== "undefined" && allowChunkReload()) {
        window.location.reload();
        // Поки браузер перезавантажується, Suspense має що показати.
        return { default: (() => null) as unknown as T };
      }
      throw err;
    }
  });
}
