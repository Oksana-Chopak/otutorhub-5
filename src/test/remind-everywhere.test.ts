import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REMIND_DELAY_MS, cancelRemind, isRemindPending, remindKey, scheduleRemind, __resetRemindQueue } from "@/lib/remindPair";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Важіль 2 аудиту шляхів 24.09: «Нагадати — там, де видно борг, і на ЛЮДИНУ,
 * а не на урок». Тести тримають три обіцянки: одна дія на всіх поверхнях,
 * одне повідомлення про весь борг пари, і «Скасувати», що справді скасовує.
 */
describe("нагадування на людину (важіль 2)", () => {
  beforeEach(() => { vi.useFakeTimers(); __resetRemindQueue(); });
  afterEach(() => { vi.useRealTimers(); __resetRemindQueue(); });

  it("надсилає не одразу: 5 секунд на «Скасувати» — надіслане не відкликається", () => {
    const send = vi.fn();
    scheduleRemind(remindKey("stu"), send);
    vi.advanceTimersByTime(REMIND_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("«Скасувати» справді скасовує — нічого не йде", () => {
    const send = vi.fn();
    scheduleRemind(remindKey("stu"), send);
    expect(cancelRemind(remindKey("stu"))).toBe(true);
    vi.advanceTimersByTime(REMIND_DELAY_MS * 3);
    expect(send).not.toHaveBeenCalled();
  });

  it("другий дотик по тій самій парі не створює другого нагадування", () => {
    const first = vi.fn(); const second = vi.fn();
    scheduleRemind(remindKey("stu"), first);
    scheduleRemind(remindKey("stu"), second);
    vi.advanceTimersByTime(REMIND_DELAY_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("різні пари не глушать одна одну; ключ розрізняє репетитора", () => {
    const a = vi.fn(); const b = vi.fn();
    scheduleRemind(remindKey("stu", "tutor-1"), a);
    scheduleRemind(remindKey("stu", "tutor-2"), b);
    expect(isRemindPending(remindKey("stu", "tutor-1"))).toBe(true);
    vi.advanceTimersByTime(REMIND_DELAY_MS);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(isRemindPending(remindKey("stu", "tutor-1"))).toBe(false);
  });

  it("таймер живе на модулі: перехід на інший екран не скасовує нагадування", () => {
    // Скасувати можна лише явно — саме тому черга не в стані компонента.
    const send = vi.fn();
    scheduleRemind(remindKey("stu"), send);
    vi.advanceTimersByTime(REMIND_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("одна дія — один компонент: копій кнопки нагадування в застосунку нема", () => {
    const files = ["src/pages/DashboardPage.tsx", "src/pages/MyStudentsPage.tsx", "src/pages/PeoplePage.tsx"];
    for (const f of files) {
      const src = read(f);
      expect(src, `${f}: нагадування мусить іти через канон RemindDebtButton`).toMatch(/<RemindDebtButton/);
      expect(src, `${f}: другої реалізації (свій invoke remind-payment) бути не може`)
        .not.toMatch(/functions\.invoke\("remind-payment"/);
    }
    const btn = read("src/components/RemindDebtButton.tsx");
    expect(btn, "кнопка кличе edge у режимі ПАРИ, а не по уроку").toMatch(/body: tutorId \? \{ studentId, tutorId \} : \{ studentId \}/);
  });

  it("edge: режим пари шле ОДНЕ повідомлення про весь борг і дзеркалить предикат боргу", () => {
    const fn = read("supabase/functions/remind-payment/index.ts");
    expect(fn).toMatch(/if \(studentId\) \{/);
    expect(fn, "борг = проведене й неоплачене; скасоване — лише зі штрафом (модель 04.09)")
      .toMatch(/l\.status === "completed" \|\| \(l\.status === "cancelled" && l\.fee\)/);
    expect(fn, "одне звернення до ядра з УСІМА уроками пари").toMatch(/lessons: debts\.map/);
    expect(fn, "за чужого репетитора нагадує лише менеджер його школи").toMatch(/is_manager_of_tutor/);
    expect(fn, "уроки незалежного — не поле школи").toMatch(/q\.neq\("source", "independent"\)/);
    expect(fn, "режим одного уроку лишається — «Фінанси» його використовують").toMatch(/lessonId \|\| body\.lesson_id/);
  });

  it("«нагадано сьогодні о 14:20» читається з логу, і лише РУЧНІ нагадування", () => {
    const h = read("src/hooks/useLastReminders.ts");
    expect(h).toMatch(/from\("lesson_payment_reminders"\)/);
    expect(h).toMatch(/\.in\("reminder_kind", \["manual", "telegram_button"\]\)/);
    expect(h, "автоматичне нагадування крона — не «я нагадала»").toMatch(/не «я нагадала»/);
  });

  it("підпис у кнопці розрізняє «сьогодні» і «раніше»", () => {
    const btn = read("src/components/RemindDebtButton.tsx");
    expect(btn).toMatch(/remind\.doneToday/);
    expect(btn).toMatch(/remind\.doneOn/);
    expect(btn, "порожній борг — не помилка, а привід порадіти").toMatch(/remind\.noDebt/);
  });

  it("ціль дотику 44px і зона доступності — кнопка не мікроскопічна", () => {
    const btn = read("src/components/RemindDebtButton.tsx");
    expect(btn).toMatch(/height: 44/);
    expect(btn).toMatch(/fontSize: 15/);
    expect(btn).toMatch(/aria-label/);
  });
});
