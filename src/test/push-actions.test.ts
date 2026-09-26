import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Важіль 3в (аудит шляхів 24.09): кнопки в САМОМУ сповіщенні.
 *
 * Головна межа, яку тримають ці тести: кнопка НЕ пише в базу з service worker.
 * Там немає сесії людини, тож «позначити оплату» звідти вимагало б підписаного
 * одноразового токена — нова поверхня для атаки на гроші. Кнопка веде глибоким
 * посиланням із уже наведеною дією, а запис лишається в застосунку.
 */
describe("кнопки в сповіщенні (важіль 3в)", () => {
  const sw = () => read("public/sw.js");

  it("service worker показує кнопки й веде за їхніми посиланнями", () => {
    const s = sw();
    expect(s).toMatch(/actions\.push\(\{ action: a\.action, title: a\.title \}\)/);
    expect(s).toMatch(/actionLinks\[a\.action\] = a\.link/);
    expect(s).toMatch(/const target = event\.action && data\.actionLinks \? data\.actionLinks\[event\.action\] : data\.link/);
  });

  it("правило «лише свій origin» діє і для кнопок — вони приходять тим самим каналом", () => {
    const s = sw();
    expect(s).toMatch(/const link = safeLink\(target \?\? data\.link\)/);
    expect(s).toMatch(/if \(u\.origin === self\.location\.origin\)/);
  });

  it("service worker НЕ пише в базу і не носить ключів", () => {
    const s = sw();
    for (const forbidden of ["supabase", "apikey", "Authorization", "rest/v1", "fetch("]) {
      expect(s, `sw.js не має робити ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("санітизація на сервері: дві кнопки максимум і лише відносний шлях", () => {
    const fn = read("supabase/functions/send-push/index.ts");
    expect(fn).toMatch(/\.slice\(0, 2\)/);
    expect(fn).toMatch(/\(a\.link as string\)\.startsWith\("\/"\) && !\(a\.link as string\)\.startsWith\("\/\/"\)/);
    expect(read("supabase/functions/_shared/push.ts")).toMatch(/actions\?: Array<\{ action: string; title: string; link: string \}>/);
  });

  it("нагадування про оплату несе кнопку «Я оплатив» у трьох мовах", () => {
    const fn = read("supabase/functions/payment-reminders/index.ts");
    expect((fn.match(/action: "ipaid"/g) ?? []).length, "індивідуальний і груповий шлях").toBe(2);
    expect(fn).toMatch(/iPaid: "Я оплатив"/);
    expect(fn).toMatch(/iPaid: "I paid"/);
    expect(fn).toMatch(/iPaid: "Jag har betalat"/);
    expect(fn, "посилання веде на сторінку оплат із наведеною дією")
      .toMatch(/\/student\/payments\?paid=\$\{lesson\.tutor_id\}/);
  });

  it("сторінка оплат відкриває аркуш сама — але не поверх уже надісланої заявки", () => {
    const page = read("src/pages/student/StudentPaymentsPage.tsx");
    expect(page).toMatch(/const autoPaidTutor = pushParams\.get\("paid"\)/);
    expect(page).toMatch(/autoOpen=\{autoPaidTutor === tp\.tutor_id\}/);
    const btn = read("src/components/IPaidButton.tsx");
    expect(btn).toMatch(/if \(autoOpen && !pending\) setOpen\(true\)/);
  });
});
