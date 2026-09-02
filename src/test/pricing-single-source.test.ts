/**
 * Ціна живе в ДВОХ місцях, які деплояться РІЗНИМИ каналами:
 *   • src/lib/pricing.ts        → фронтенд, їде з Lovable Publish;
 *   • supabase/functions/liqpay-create-payment → edge-функція, деплой окремо.
 *
 * Перевірка 02.09: на сторінці тарифів стояла нова ціна, а LiqPay виставляв
 * стару — рівно тому, що канали різні, а розбіжність нічим не ловилась.
 * Цей гейт ловить її ще до деплою: числа в обох файлах мусять збігатися.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { PRICE_TOTAL } from "@/lib/pricing";

const FN = "supabase/functions/liqpay-create-payment/index.ts";

function planUah(src: string, plan: string): number {
  const m = src.match(new RegExp(`${plan}\\s*:\\s*\\{[^}]*uah\\s*:\\s*(\\d+)`));
  if (!m) throw new Error(`У ${FN} не знайдено суму для плану «${plan}»`);
  return Number(m[1]);
}

describe("ціна — одне джерело правди на два канали деплою", () => {
  const src = readFileSync(FN, "utf8");

  for (const plan of ["monthly", "halfyear", "yearly"] as const) {
    it(`${plan}: LiqPay виставляє рівно ${PRICE_TOTAL[plan]} ₴`, () => {
      expect(planUah(src, plan)).toBe(PRICE_TOTAL[plan]);
    });
  }

  it("в edge-функції не лишилось конвертації за курсом", () => {
    expect(src).not.toMatch(/nbu|exchange|rate\s*[:=]|usd/i);
  });
});
