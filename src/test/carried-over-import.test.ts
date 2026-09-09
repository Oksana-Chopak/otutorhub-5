/**
 * Імпорт «усе, що є» (07.09): перенесений борг = cancelled + штраф + carried_over.
 * Тримаємо три речі, які легко зламати «покращенням»:
 *   1) борг лягає саме так (інакше він або зникне з грошей, або поїде в
 *      «проведено»/серії/бейджі);
 *   2) сервер сам перевіряє замок (is_tutor_pro) — клієнтський PaywallSheet
 *      не єдиний бар'єр;
 *   3) останнє визначення lessons_visible в історії міграцій досі скоуплене
 *      на школу (перевипуск заради carried_over не зняв is_hub_scoped).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migDir = join(root, "supabase/migrations");
const mig = readFileSync(join(migDir, "20260907150000_carried_over_import.sql"), "utf8");

describe("імпорт · перенесений борг", () => {
  it("колонка carried_over + RPC import_student_bundle", () => {
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS carried_over boolean NOT NULL DEFAULT false/);
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.import_student_bundle\(/);
  });
  it("борг = cancelled + is_cancellation_fee + carried_over; ціна — через update_lesson_details_safe", () => {
    const i = mig.indexOf("FUNCTION public.import_student_bundle(");
    const body = mig.slice(i);
    expect(body).toMatch(/'cancelled', 'independent', _caller, 'individual', true\)/);
    expect(body).toMatch(/'student_payment_status', 'unpaid', 'is_cancellation_fee', true\)/);
    expect(body).toMatch(/public\.add_or_link_independent_student\(/);
    expect(body).toMatch(/public\.wallet_topup\(/);
    // жодного прямого INSERT у lesson_details — лише канонічний RPC
    expect(body).not.toMatch(/INSERT INTO public\.lesson_details/);
  });
  it("серверний замок: гроші/розклад лише з is_tutor_pro; імена — завжди", () => {
    const i = mig.indexOf("FUNCTION public.import_student_bundle(");
    const body = mig.slice(i);
    expect(body).toMatch(/IF _needs_pro AND NOT public\.is_tutor_pro\(_caller\) THEN\s+RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED'/);
    expect(body).toMatch(/NOT public\.is_independent_tutor\(_caller\)/);
  });
  it("останній lessons_visible в історії міграцій — зі скоупом школи і з carried_over", () => {
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    let last = "";
    for (const f of files) {
      const t = readFileSync(join(migDir, f), "utf8");
      const i = t.lastIndexOf("CREATE VIEW public.lessons_visible");
      if (i >= 0) last = t.slice(i, t.indexOf("GRANT SELECT ON public.lessons_visible", i));
    }
    expect(last).toMatch(/is_hub_scoped\(l\.tutor_id\)/);
    expect(last).toMatch(/l\.carried_over/);
  });
  it("бейдж «Нуль боргів» рахує борг за моделлю 04.09 (штраф = борг)", () => {
    expect(mig).toMatch(/l\.status = 'completed' OR \(l\.status = 'cancelled' AND ld\.is_cancellation_fee IS TRUE\)/);
  });
});

describe("імпорт · клієнт і edge бачать перенесені борги як гроші, не як уроки", () => {
  const src = (p: string) => readFileSync(join(root, p), "utf8");
  it("розклад/дашборд/учнівський розклад ховають carried_over; фінанси й оплати — підписують", () => {
    expect(src("src/pages/SchedulePage.tsx")).toMatch(/carried_over !== true/);
    expect(src("src/pages/DashboardPage.tsx")).toMatch(/carried_over !== true/);
    expect(src("src/pages/student/StudentSchedulePage.tsx")).toMatch(/carried_over !== true/);
    expect(src("src/pages/FinancesPage.tsx")).toMatch(/finances\.carriedOverTag/);
    expect(src("src/pages/student/StudentPaymentsPage.tsx")).toMatch(/studentPagesExtra\.carriedOverDebt/);
  });
  it("нагадування про оплату й тижневий дайджест беруть штрафи/перенесені борги", () => {
    expect(src("supabase/functions/payment-reminders/index.ts")).toMatch(/\.eq\("carried_over", true\)/);
    expect(src("supabase/functions/tutor-weekly-digest/index.ts")).toMatch(/is_cancellation_fee === true/);
  });
  it("імпорт сам зводить борг і передоплату в нетто перед записом", () => {
    expect(src("src/components/ImportStudentsSheet.tsx")).toMatch(/netDebtAndPrepay\(r\)/);
    // Горизонт 4 тижні живе в чистій бібліотеці, бо на нього спирається і
    // лендінговий калькулятор. Компонент НЕ має оголошувати власну копію —
    // дві константи розійшлись би, і лендінг почав би обіцяти не те число.
    expect(src("src/lib/importStudents.ts")).toMatch(/IMPORT_SCHEDULE_WEEKS = 4/);
    expect(src("src/components/ImportStudentsSheet.tsx")).not.toMatch(/const IMPORT_SCHEDULE_WEEKS/);
  });
});
