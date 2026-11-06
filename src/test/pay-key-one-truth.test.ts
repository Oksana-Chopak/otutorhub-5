import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { payKey, payUrlFor, PAY_SHORT_RE, PAY_TOKEN_RE } from "../../supabase/functions/_shared/payLink";

const ROOT = join(import.meta.dirname ?? __dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * КЛЮЧ СТОРІНКИ ОПЛАТИ — ОДНЕ ВИЗНАЧЕННЯ (06.11).
 *
 * Пакет 01.11 додав коротке посилання `/p/<8 знаків>`: воно пішло в аркуш
 * «Нагадати» і в автоматичні нагадування, база його розуміє, сторінка передає
 * його edge-функції як є. А `pay-link` лишилась із перевіркою «лише 64 hex» —
 * і КОЖНЕ коротке посилання відповідало «link not found» ще до звернення до
 * бази. Мама, що тапнула посилання з нагадування, не бачила ні боргу, ні
 * реквізитів, ні кнопки «Я оплатила»; та сама перевірка глушила і POST, тож
 * сказати «я оплатила» теж було неможливо.
 */
describe("ключ сторінки оплати", () => {
  it("приймає обидві форми — короткий код і довгий токен", () => {
    expect(payKey("ab12cd34"), "8 знаків — саме те, що розсилається з 01.11").toBe("ab12cd34");
    expect(payKey("f".repeat(64)), "старі посилання лишаються живі").toBe("f".repeat(64));
    expect(payKey("AB12CD34"), "регістр не має значення").toBe("ab12cd34");
    expect(payKey("  ab12cd34  "), "пробіли з копіювання").toBe("ab12cd34");
    expect(payKey("23456789"), "код із самих цифр — теж код, в алфавіті є 2–9").toBe("23456789");
  });

  it("пропускає КОЖЕН знак, який база може видати", () => {
    // Якби форма звузилася (скажімо, лишила тільки літери), частина живих
    // посилань стала б мертвою — і випадково, залежно від того, що випало
    // генератору.
    const mig = read("supabase/migrations/20261101120000_pravda.sql");
    const alpha = /_alpha constant text := '([^']+)'/.exec(mig)?.[1] ?? "";
    expect(alpha.length, "алфавіт коротких кодів прочитано з міграції").toBeGreaterThan(20);
    for (const ch of alpha) {
      expect(payKey(ch.repeat(8)), `знак «${ch}» має проходити`).toBe(ch.repeat(8));
    }
  });

  it("не приймає нічого іншого — двері лишаються вузькими", () => {
    for (const bad of ["", "short", "ab12cd3", "ab12cd345", "ab12cd3!", "../etc", "ab 12cd34", "f".repeat(63), "g".repeat(64), null, undefined]) {
      expect(payKey(bad as unknown), `«${String(bad)}» не ключ`).toBeNull();
    }
  });

  it("адреса будується за формою ключа, а не навмання", () => {
    expect(payUrlFor("ab12cd34", "https://otutorhub.com")).toBe("https://otutorhub.com/p/ab12cd34");
    expect(payUrlFor("f".repeat(64), "https://otutorhub.com/")).toBe(`https://otutorhub.com/pay/${"f".repeat(64)}`);
    expect(payUrlFor("непотріб", "https://otutorhub.com"), "без посилання нагадування все одно йде").toBe("");
  });

  it("усі, хто читає чи будує ключ, беруть його зі спільного модуля", () => {
    const payLinkFn = read("supabase/functions/pay-link/index.ts");
    expect(payLinkFn, "edge приймає ключ спільною функцією").toContain("payKey(raw)");
    expect(payLinkFn, "власної форми в edge більше немає").not.toMatch(/0-9a-f\]\{64\}/);
    for (const f of ["supabase/functions/_shared/paymentReminder.ts", "supabase/functions/payment-reminders/index.ts"]) {
      const src = read(f);
      expect(src, `${f}: адреса будується спільною функцією`).toContain("payUrlFor(");
      expect(src, `${f}: власних форм ключа немає`).not.toMatch(/a-z0-9\]\{8\}|0-9a-f\]\{64\}/);
    }
  });

  it("база приймає РІВНО ті самі дві форми", () => {
    // Якщо SQL і edge розійдуться, половина посилань знову стане мертвою — але
    // тихо: сторінка просто скаже «не знайдено».
    const mig = read("supabase/migrations/20261101120000_pravda.sql");
    const lookup = mig.slice(mig.indexOf("FUNCTION public.payment_link_lookup"), mig.indexOf("FUNCTION public.payment_link_view"));
    expect(lookup, "коротка форма").toContain("^[a-z0-9]{8}$");
    expect(lookup, "довга форма").toContain("^[0-9a-f]{64}$");
    expect(PAY_SHORT_RE.source).toBe("^[a-z0-9]{8}$");
    expect(PAY_TOKEN_RE.source).toBe("^[0-9a-f]{64}$");
  });

  it("браузерна копія (інший рантайм, інший бандл) погоджується на коротку форму", () => {
    // `src/lib` не може імпортувати Deno-модуль, тож копія неминуча — але вона
    // мусить збігатися, і це перевіряється, а не покладається на увагу.
    const client = read("src/lib/payLink.ts");
    expect(client).toContain("/^[a-z0-9]{8}$/");
  });
});
