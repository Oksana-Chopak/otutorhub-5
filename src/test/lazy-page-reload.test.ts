/**
 * Публікація не має ламати екран тому, хто вже всередині (08.11).
 *
 * З журналу помилок: «Cannot read properties of undefined (reading 'default')»
 * на /dashboard. Саме так падає React.lazy, коли чанк сторінки не
 * завантажився — а не завантажується він насамперед тому, що ми щойно
 * опублікували нову версію: стара вкладка просить файл зі старим хешем, якого
 * вже немає. Для продукту, що оновлюється часто, це правило, а не рідкість.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { allowChunkReload, RELOAD_GUARD_MS } from "@/lib/lazyPage";

const APP = readFileSync("src/App.tsx", "utf8");

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
});

describe("чанк зник після публікації", () => {
  it("перший збій дозволяє перезавантаження", () => {
    expect(allowChunkReload(1_000_000)).toBe(true);
  });

  it("другий збій поспіль — НЕ дозволяє: інакше вічне коло", () => {
    expect(allowChunkReload(1_000_000)).toBe(true);
    expect(allowChunkReload(1_000_000 + RELOAD_GUARD_MS - 1), "у межах вікна").toBe(false);
  });

  it("через вікно — знову дозволяє (це вже інша публікація)", () => {
    expect(allowChunkReload(1_000_000)).toBe(true);
    expect(allowChunkReload(1_000_000 + RELOAD_GUARD_MS + 1)).toBe(true);
  });

  it("приватний режим (sessionStorage кидає) не ламає рішення", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const spy2 = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(allowChunkReload(2_000_000)).toBe(true);
    spy.mockRestore(); spy2.mockRestore();
  });

  it("усі сторінки застосунку йдуть через цей шлях, а не через голий lazy", () => {
    expect(APP, "жодного голого lazy(() => import(").not.toMatch(/\blazy\(\(\) => import\(/);
    expect((APP.match(/lazyPage\(\(\) => import\(/g) ?? []).length, "усі 43 сторінки (11.11: + публічна сторінка школи)").toBe(43);
  });

  it("порожній модуль вважається збоєм, а не сторінкою", () => {
    // Саме «порожній модуль» і дає той текст помилки: React читає .default.
    expect(readFileSync("src/lib/lazyPage.ts", "utf8")).toMatch(/typeof \(mod as PageModule<T>\)\.default === "undefined"/);
  });
});
