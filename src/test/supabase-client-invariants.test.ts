import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * B7-розтяжка: client.ts автогенерується Lovable — регенерація може мовчки
 * викинути обгортку fetchWithTimeout (таймаут 15с + ретраї читань), і «вічний
 * спінер у метро» повернеться без жодного червоного гейта. Цей тест робить
 * втрату обгортки помилкою збірки: після регенерації рядок треба повернути.
 */
describe("supabase client invariants", () => {
  const src = readFileSync("src/integrations/supabase/client.ts", "utf-8");

  it("client.ts підключає fetchWithTimeout (таймаут + ретраї читань)", () => {
    expect(src).toContain('import { fetchWithTimeout } from \'./fetchWithTimeout\'');
    expect(src).toContain("global: { fetch: fetchWithTimeout }");
  });

  it("обгортка не ретраїть мутації (тільки GET/HEAD)", () => {
    const wrapper = readFileSync("src/integrations/supabase/fetchWithTimeout.ts", "utf-8");
    expect(wrapper).toMatch(/method === "GET" \|\| method === "HEAD"/);
  });
});
