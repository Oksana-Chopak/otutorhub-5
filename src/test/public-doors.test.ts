import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * «Публічні двері» (27.09, скан як інженер автономних систем).
 * Дві публічні edge-функції (verify_jwt=false, службовий ключ) створюють акаунти
 * і розсилають листи. Їхній ліміт жив у памʼяті ізолята з ключем «IP+пошта» —
 * тобто не існував. Анкета підбору перезаписувала чужий телефон. Злиття
 * запрошеного профілю за телефоном віддавало чуже місце, а з уроками — падало.
 * Ці інваріанти тримають клас від повернення; поведінку бази доводить
 * сценарій scripts/db-replay/scenarios/96-public-doors.sql.
 */

const PUBLIC_DOORS = ["landing-find-tutor-quiz", "confirm-pending-signup"];

describe("публічні функції обмежують частоту в БАЗІ, а не в памʼяті ізолята", () => {
  for (const fn of PUBLIC_DOORS) {
    const src = () => noComments(read(`supabase/functions/${fn}/index.ts`));

    it(`${fn}: бере ліміт зі спільного _shared/rateLimit.ts`, () => {
      const s = src();
      expect(s).toMatch(/from ['"]\.\.\/_shared\/rateLimit\.ts['"]/);
      expect((s.match(/rateLimit\(admin,/g) ?? []).length, "принаймні два виміри: адреса і пошта/платформа")
        .toBeGreaterThanOrEqual(2);
      expect(s).toMatch(/verdicts\.includes\(['"]limit['"]\)/);
    });

    it(`${fn}: власного лічильника в памʼяті більше немає`, () => {
      const s = src();
      expect(s).not.toMatch(/function rateLimited\(/);
      expect(s).not.toMatch(/new Map<string, number\[\]>\(\)/);
    });

    it(`${fn}: акаунт за поштою — з бази, не listUsers по 200`, () => {
      const s = src();
      expect(s).not.toMatch(/listUsers/);
      expect(s).toMatch(/user_id_by_email/);
    });
  }
});

describe("анкета підбору не переписує чужі дані", () => {
  const s = () => noComments(read("supabase/functions/landing-find-tutor-quiz/index.ts"));

  it("телефон у profile_contacts — лише для щойно створеного акаунта", () => {
    const src = s();
    expect(src).toMatch(/let isNewAccount = false;/);
    expect(src).toMatch(/isNewAccount = true;/);
    const guard = /if \(isNewAccount && userId && phone\) \{[\s\S]*?profile_contacts/;
    expect(src, "upsert телефону мусить стояти під умовою isNewAccount").toMatch(guard);
    expect((src.match(/from\("profile_contacts"\)/g) ?? []).length, "один-єдиний запис у контакти").toBe(1);
  });

  it("ліміт на пошту — щоб чужу скриньку не завалити листами підтвердження", () => {
    const src = s();
    expect(src).toMatch(/rateLimit\(admin, "landing_quiz_email", email,/);
    expect(src).toMatch(/rateLimit\(admin, "landing_quiz_ip", ip,/);
    expect(src).toMatch(/rateLimit\(admin, "landing_quiz_all", "platform",/);
  });
});

describe("спільний лімітер", () => {
  const s = () => noComments(read("supabase/functions/_shared/rateLimit.ts"));

  it("правда — RPC rate_limit_check у базі", () => {
    expect(s()).toMatch(/\(admin\.rpc as any\)\("rate_limit_check"/);
  });

  it("без бази двері не навстіж: запасний лічильник + рядок в error_log", () => {
    const src = s();
    expect(src).toMatch(/memLimited\(/);
    expect(src).toMatch(/from\("error_log"\)\.insert\(/);
    expect(src).toMatch(/return memLimited\(/);
  });
});

describe("міграція 20260927150000_public_doors і сценарій 96", () => {
  const MIG = "supabase/migrations/20260927150000_public_doors.sql";

  it("файл міграції і сценарій на місці", () => {
    expect(existsSync(join(ROOT, MIG))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/db-replay/scenarios/96-public-doors.sql"))).toBe(true);
  });

  it("rate_limit_check і user_id_by_email — лише для service_role", () => {
    const m = read(MIG);
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.rate_limit_check\(_scope text, _key text, _max integer, _window_seconds integer\)/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.rate_limit_check\(text, text, integer, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.rate_limit_check\(text, text, integer, integer\) TO service_role;/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.user_id_by_email\(text\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.user_id_by_email\(text\) TO service_role;/);
  });

  it("адреса зберігається лише хешем, рядки живуть добу", () => {
    const m = read(MIG);
    expect(m).toMatch(/_h := md5\(_scope \|\| chr\(10\) \|\| lower\(trim\(_key\)\)\);/);
    expect(m).toMatch(/DELETE FROM public\.rate_limit_hits WHERE hit_at < now\(\) - interval '1 day';/);
  });

  it("злиття запрошеного профілю: телефон — лише коли пошти немає; чужі контакти цілі", () => {
    const m = read(MIG);
    expect(m).toMatch(/c\.phone = _phone AND coalesce\(c\.email, ''\) = ''/);
    // старий рядок видалення контактів БУДЬ-КОГО зі спільним телефоном — прибрано
    expect(m).not.toMatch(/OR \(_phone IS NOT NULL AND _phone <> '' AND phone = _phone\)\s*\n\s*OR user_id = _ghost_id/);
    expect(m).toMatch(/p\.is_pending = true\)\s*\n\s*\)\s*\n\s*\);/);
  });

  it("protect_lesson_fields шанує прапорець злиття — інакше запрошені з уроками реєструються порожніми", () => {
    const m = read(MIG);
    expect(m).toMatch(/_merging boolean := COALESCE\(current_setting\('app\.pending_profile_merge', true\), ''\) = 'on';/);
    expect(m).toMatch(/IF NOT _merging AND NEW\.student_id IS DISTINCT FROM OLD\.student_id THEN/);
    expect(m).toMatch(/IF NOT _merging AND NEW\.tutor_id IS DISTINCT FROM OLD\.tutor_id THEN/);
    // а source для людей з браузера — так само незмінний
    expect(m).toMatch(/IF auth\.uid\(\) IS NOT NULL AND NEW\.source IS DISTINCT FROM OLD\.source THEN/);
  });
});
