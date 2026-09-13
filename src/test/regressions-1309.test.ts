/**
 * Сім дефектів зі скану 13.09 («ти точно нічого не зламав?») — кожен
 * прибитий до джерела, щоб не повернувся наступною правкою:
 *  1. матеріали учня питали lesson_details.currency, якої НЕ існує → 400 → порожньо;
 *  2. sync-google-calendar питав lessons.location, якої НЕ існує → 500 на кожен виклик;
 *  3. confirm-pending-signup: service_role без EXECUTE на is_pending_email;
 *  4. send-push відповідав 500 без VAPID-секретів замість пропустити веб-гілку;
 *  5. лендінг у системному дарку: токени застосунку робили текст білим на кремовому;
 *  6. імпорт мовчки пропускав «борг N уроків» без ціни;
 *  7. ручне «Нагадати» блокувалось автоматичним нагадуванням за добу.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VAPID_PUBLIC_KEY } from "@/lib/pushConfig";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const types = src("src/integrations/supabase/types.ts");
const rowOf = (table: string) => {
  const i = types.indexOf(`      ${table}: {`);
  const r = types.indexOf("Row: {", i);
  return types.slice(r, types.indexOf("}", r));
};

describe("регресії скану 13.09", () => {
  it("1. матеріали учня не питають колонок, яких немає в живій схемі", () => {
    const sm = src("src/components/StudentMaterials.tsx");
    const sel = sm.match(/from\("lesson_details"\)\s*\.select\("([^"]+)"\)/)?.[1] ?? "";
    expect(sel).toBeTruthy();
    const live = rowOf("lesson_details");
    for (const col of sel.split(",").map((c) => c.trim())) expect(live, `lesson_details.${col}`).toContain(`${col}:`);
    expect(sm).toMatch(/if \(det\.error\) throw det\.error/); // помилка більше не ковтається мовчки
    expect(sm).toMatch(/from\("student_rates"\)\.select\("currency"\)/);
  });

  it("2. синхронізація календаря не питає lessons.location", () => {
    const fn = src("supabase/functions/sync-google-calendar/index.ts");
    const sel = fn.match(/from\("lessons"\)[\s\S]*?\.select\("([^"]+)"\)/)?.[1] ?? "";
    expect(sel).toBeTruthy();
    const live = rowOf("lessons");
    for (const col of sel.split(",").map((c) => c.trim())) expect(live, `lessons.${col}`).toContain(`${col}:`);
    expect(fn).not.toMatch(/lesson\.location/);
  });

  it("3. міграція дає service_role EXECUTE на RPC edge-функцій, не чіпаючи anon/authenticated", () => {
    const mig = src("supabase/migrations/20260913090000_service_role_rpc_grants.sql");
    for (const fn of ["is_pending_email(text)", "check_user_role(uuid, public.app_role)", "enqueue_email(text, jsonb)", "grant_pro_days(uuid, integer, text, jsonb)"]) {
      expect(mig).toContain(`'public.${fn}'`);
    }
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
    expect(mig).not.toMatch(/TO (anon|authenticated)/);
    expect(mig).toMatch(/LIVE-MARKER-NONE/);
  });

  it("4. send-push: без VAPID — пропуск веб-гілки, а не 500; публічний ключ = ключу клієнта", () => {
    const fn = src("supabase/functions/send-push/index.ts");
    expect(fn).not.toMatch(/!VAPID_PUBLIC_KEY \|\| !VAPID_PRIVATE_KEY/);
    expect(fn).toMatch(/const WEB_PUSH_READY\s*=\s*!!VAPID_PRIVATE_KEY/);
    expect(fn).toContain(`"${VAPID_PUBLIC_KEY}"`);
    expect(fn).toMatch(/\[401, 403, 404, 410\]\.includes\(res\.status\)/);
    // клієнт перепідписує браузер, якщо ключ змінився
    expect(src("src/hooks/usePushNotifications.ts")).toMatch(/await sub\.unsubscribe\(\)/);
  });

  it("5. лендінг замкнений на світлу палітру; «один день» читає лендінгові токени", () => {
    const lp = src("src/pages/LandingPage.tsx");
    expect(lp).toMatch(/\.landing-root \{[^}]*color-scheme: light/);
    expect(lp).toMatch(/--txt: var\(--ink\)/);
    expect(lp).toMatch(/--foreground: 224 71% 9%/);
    const ds = src("src/components/landing/LandingDayStory.tsx");
    expect(ds).not.toMatch(/var\(--txt|var\(--surface|var\(--border,|var\(--teal,/);
  });

  it("6. імпорт: борг уроками без ціни → учень створюється, борг — у нотатку", () => {
    const sheet = src("src/components/ImportStudentsSheet.tsx");
    expect(sheet).toMatch(/const debtLessonsNoPrice = net\.debtLessons > 0 && !\(r\.price && r\.price > 0\)/);
    expect(sheet).toMatch(/_debt_lessons: debtLessonsNoPrice \? 0 : net\.debtLessons/);
    expect(sheet).toMatch(/importStudents\.noteDebtLessons/);
    expect(sheet).toMatch(/importStudents\.failedNames/);
  });

  it("7. ручне нагадування дедуплікується лише проти ручного і лише годину; клієнт пояснює, а не червоніє", () => {
    const rp = src("supabase/functions/remind-payment/index.ts");
    expect(rp).toMatch(/dedupKind: "manual", dedupHours: 1/);
    expect(rp).toMatch(/lastSentAt: result\.lastSentAt/);
    const core = src("supabase/functions/_shared/paymentReminder.ts");
    expect(core).toMatch(/\.eq\("reminder_kind", input\.dedupKind\)/);
    expect(core).toMatch(/sent_at: sentAt/);
    const fin = src("src/pages/FinancesPage.tsx");
    expect(fin).toMatch(/reason === "already_reminded_today"/);
    expect(fin).toMatch(/pendingPaymentsExtra\.alreadyReminded/);
  });
});
