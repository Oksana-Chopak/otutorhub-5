import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Аудит 18.09 по екранах, ролях і потоках. Спільний знаменник усіх знахідок —
 * ФАЛЬШИВИЙ УСПІХ: людині кажуть «готово», а запис не стався; або показують
 * спокійну цифру там, де дані не прочитались. Кожен блок нижче — доказ, що
 * конкретний випадок більше не мовчить.
 */
describe("аудит 18.09: фальшивий успіх і мовчазні гроші", () => {
  it("LiqPay: збій запису підписки НЕ відповідає платіжці «OK»", () => {
    const f = read("supabase/functions/liqpay-callback/index.ts");
    expect(f, "без цього репетитор платить карткою і лишається за пейволом")
      .toMatch(/const \{ error: subErr \} = await admin/);
    expect(f).toMatch(/if \(subErr\)[\s\S]{0,200}status: 500/);
    expect(f).toMatch(/const \{ error: unsubErr \} = await admin/);
  });

  it("Telegram: кнопка оплати не каже «готово», коли запис не пройшов", () => {
    const f = read("supabase/functions/telegram-poll/index.ts");
    const writes = f.match(/wrote = false/g) ?? [];
    expect(writes.length, "чотири оновлення статусу — чотири перевірки").toBeGreaterThanOrEqual(4);
    expect((f.match(/if \(!wrote\) \{ await answerCb\(base, cqId, L\.writeFailed\); return; \}/g) ?? []).length).toBe(2);
    for (const loc of ["Не вдалося зберегти", "Could not save", "Kunde inte spara"]) {
      expect(f, `текст збою для ${loc} відсутній`).toContain(loc);
    }
  });

  it("Нагадування про уроки: журнал дедупу більше не падає мовчки", () => {
    const f = read("supabase/functions/lesson-reminders/index.ts");
    expect((f.match(/const \{ error: logErr \} = await supabase\.from\("lesson_reminders"\)\.insert\(/g) ?? []).length).toBe(4);
    expect((f.match(/if \(logErr\) console\.error/g) ?? []).length).toBe(4);
  });

  it("Урок: хабовому не пропонують позначити оплату, якої він не може зберегти", () => {
    const f = read("src/components/LessonWorkspace.tsx");
    // update_lesson_details_safe має v_student_ok = false для source='hub' і
    // МОВЧКИ не пише статус, повертаючи успіх — тому пропозиції не має бути.
    expect(f).toMatch(/paidLocal === "unpaid" && canTogglePayment/);
    expect(f, "смуга дії мусить питати право, як і блок нижче")
      .toMatch(/statusLocal === "completed" && \(!summary \|\| \(paidLocal === "unpaid" && canTogglePayment\)\)/);
  });

  it("Урок: нуль у ціні пишеться словами, а не «0 ₴»", () => {
    const f = read("src/components/LessonWorkspace.tsx");
    expect(f, "тригер бази створює рядок деталей із 0, тож гард на null нічого не ловив")
      .not.toMatch(/studentPrice !== undefined && studentPrice !== null/);
    expect(f).toMatch(/Number\(studentPrice\) > 0 \?/);
    expect(f).toMatch(/lessonWorkspaceExtra\.priceNotSet/);
  });

  it("Груповий урок менеджера лягає під ОБРАНОГО репетитора", () => {
    const f = read("src/components/QuickLessonDialog.tsx");
    expect(f, "user.id тут означав, що урок дістається менеджеру, а не репетитору")
      .not.toMatch(/createGroupLesson\(\{\s*\n\s*tutorId: user\.id/);
    expect(f).toMatch(/tutorId: effTutorId/);
  });

  it("Приватні нотатки: один заголовок, без обірваної дужки в en/sv", () => {
    const f = read("src/components/ManagerNotes.tsx");
    expect(f, "вшитий укр-заголовок + replace по українській підстроці")
      .not.toMatch(/\.replace\("Приватні нотатки \("/);
    expect(f).toMatch(/t\("managerNotesExtra\.titleWithCount"/);
    expect(f).toMatch(/t\("managerNotes\.title"\)/);
  });

  it("Сторінка відписки говорить мовою одержувача", () => {
    const f = read("src/pages/MarketingUnsubscribePage.tsx");
    expect((f.match(/t\("marketingUnsub\./g) ?? []).length).toBeGreaterThanOrEqual(12);
    const body = f.slice(f.indexOf("export default"));
    expect(body, "лист відкривають із пошти, де мова ще не обрана")
      .not.toMatch(/"[^"]*[а-яіїєґ]{4}/i);
    for (const loc of ["uk", "en", "sv"]) {
      expect(read(`src/i18n/locales/${loc}.ts`)).toMatch(/marketingUnsub: \{/);
    }
  });

  it("Учень: неповний список групових уроків кажеться словами", () => {
    const lib = read("src/lib/studentLessons.ts");
    expect(lib).toMatch(/partial: !!error/);
    expect(lib, "кидати не можна: жоден виклик не в try/catch — сторінка зависне")
      .not.toMatch(/if \(error\) throw error/);
    for (const p of ["src/pages/student/StudentSchedulePage.tsx", "src/pages/student/StudentDashboardPage.tsx"]) {
      expect(read(p)).toMatch(/if \(groupsPartial\) toast\.error/);
    }
  });

  it("22.09 пуші: тимчасовий збій НЕ стирає реєстрацію пристрою", () => {
    const f = read("supabase/functions/send-push/index.ts");
    // Скан Lovable, підтверджено: будь-яке false видаляло підписку назавжди.
    expect(f).toMatch(/Promise<"ok" \| "gone" \| "retry">/);
    expect(f, "видаляється лише те, що push-сервіс назвав мертвим")
      .toMatch(/r\.status === "fulfilled" && r\.value === "gone"/);
    expect(f, "401/403 може бути НАШОЮ помилкою ключа — стирати всім не можна")
      .toMatch(/if \(res\.status === 401 \|\| res\.status === 403\) \{[\s\S]{0,160}return "retry";/);
    expect(f).toMatch(/if \(res\.status === 404 \|\| res\.status === 410\) \{[\s\S]{0,120}return "gone";/);
    expect(f, "старе правило «будь-який збій = мертва»").not.toMatch(/r\.status !== "fulfilled" \|\| !r\.value/);
  });

  it("22.09 дайджест: хабовий репетитор не бачить борг учня перед ШКОЛОЮ", () => {
    const f = read("supabase/functions/tutor-daily-digest/index.ts");
    // Функція ходить службовим ключем і обходить маску lessons_visible.
    expect(f).toMatch(/l\.tutor_id === userId && l\.source === "independent"\)\) \{\s*\n\s*noteDebt/);
    expect(f).toMatch(/r\.tutor_id === userId && r\.source === "independent"\)\) \{\s*\n\s*noteDebt/);
    expect(f, "без фільтра хабовий отримує ціни школи й бачить її маржу")
      .not.toMatch(/\(unpaidLessons \?\? \[\]\)\.filter\(\(l: any\) => l\.tutor_id === userId\)\) \{/);
  });

  it("22.09 Люди: «⚠️ Борг» рахується тим самим предикатом, що й усюди", () => {
    const f = read("src/pages/PeoplePage.tsx");
    // Фолбек жив на скасованій 04.09 моделі «передоплати»: майбутні неоплачені
    // уроки ставали боргом, і менеджер писав учневі про гроші, яких той не винен.
    expect(f).toMatch(/import \{ isStudentDebtLesson \} from "@\/lib\/financials"/);
    expect(f).toMatch(/if \(isStudentDebtLesson\(\{[\s\S]{0,260}is_cancellation_fee: det\?\.is_cancellation_fee === true/);
    expect(f, "без цієї колонки штраф за скасування і перенесений борг зникають із боргу")
      .toMatch(/\.select\("id, student_payment_status, student_price, is_cancellation_fee"\)/);
    expect(f, "стара умова «будь-який неоплачений з ціною, крім скасованих»")
      .not.toMatch(/l\.status !== "cancelled" &&\s*\n\s*l\.status !== "pending" &&/);
    expect(f, "упалий чанк мовчки занижував борг").toMatch(/if \(chunkErr\) console\.error/);
  });

  it("Учень: збій по групових оплатах не показує впевнений нуль", () => {
    const f = read("src/pages/student/StudentPaymentsPage.tsx");
    expect(f).toMatch(/const \{ data: gParts, error: gErr \}/);
    expect(f).toMatch(/if \(gErr\) \{ setLoadError\(true\); \}/);
  });
});
