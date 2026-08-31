/**
 * 49: DROP POLICY IF EXISTS мовчить, коли імені не існує.
 *
 * Через це свіп хвилі 45 «закрив» три діри, які лишились відкритими: імена
 * політик я написав із пам'яті («Managers view financial contacts») замість
 * справжніх («Managers see all financial contacts»). Міграція виконалась без
 * помилки, коментар оголошував успіх, банківські реквізити читались далі.
 *
 * Цей тест робить такий промах неможливим: кожне ім'я в DROP POLICY мусить
 * колись бути створене якимось CREATE POLICY у тій самій історії міграцій.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const migDir = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");

/**
 * Мій власний промах хвилі 45: три DROP з вигаданими іменами. Вони НЕ
 * виправляються на місці — файл 20260831115658 є записом того, що справді
 * виконалось у Lovable, і переписати його означало б збрехати про історію.
 * Замість цього промах названо тут, із вказівкою на міграцію, що його
 * виправила справжніми іменами. Стирати помилку — не те саме, що виправити її.
 */
const CORRECTED_BY_20260831200000 = new Set([
  "profile_financial_contacts::Managers view financial contacts", // → «Managers see all financial contacts»
  "chat_message_attachments::Manager views all attachments",      // → «Manager views all chat attachments»
  "pro_bonus_ledger::Managers view bonus ledger",                 // → «Manager views all bonuses»
]);

/** Політики, створені поза історією міграцій (Supabase-дефолти, ручні правки). */
const KNOWN_EXTERNAL = new Set([
  "lessons::Student creates own lessons",
  "student_rates::Manager sees all rates",
  "lessons::Manager updates any lessons",
  "lessons::Manager deletes any lessons",
  "suppressed_emails::Service role can view suppressed emails",
  "suppressed_emails::Service role inserts suppressed emails",
  "suppressed_emails::Service role reads suppressed emails",
  "tutor_referral_requests::Students view own referral requests",
  "tutor_referral_requests::students_view_own_referral_requests",
]);

describe("імена політик у міграціях", () => {
  it("кожен DROP POLICY називає політику, яку колись створював CREATE POLICY", () => {
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    const created = new Set<string>();
    const drops: Array<{ key: string; file: string }> = [];

    for (const f of files) {
      const text = readFileSync(join(migDir, f), "utf8");
      for (const m of text.matchAll(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.|storage\.)?"?(\w+)"?/gi)) {
        created.add(`${m[2]}::${m[1]}`);
      }
      for (const m of text.matchAll(/DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.|storage\.)?"?(\w+)"?/gi)) {
        drops.push({ key: `${m[2]}::${m[1]}`, file: f });
      }
    }

    const phantom = drops
      .filter((d) => !created.has(d.key) && !KNOWN_EXTERNAL.has(d.key) && !CORRECTED_BY_20260831200000.has(d.key))
      .map((d) => `${d.file}: DROP «${d.key}» — такої політики ніхто не створював`);

    expect([...new Set(phantom)]).toEqual([]);
  });
});
