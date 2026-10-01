/**
 * Блокер Б1 (аудит 01.10) — головна картка учня. Баланс передоплати завжди
 * виходив 0 (поле `student_id` не входило в select, з яким його порівнювали),
 * тож картка «що далі» ЗАВЖДИ казала «Передоплата вичерпана», а стани під нею
 * («Наступний урок», «Серію перервано», «Розклад порожній») були недосяжні.
 * Тут закріплено те, через що це сталось: «немає передоплати в уроках» і
 * «не прочитав» — це `null`, а не нуль.
 */
import { describe, it, expect } from "vitest";
import { prepaidLessonBalance } from "@/lib/studentPrepaid";

const W = (tutor_id: string, lessons_balance: number | null) => ({ tutor_id, lessons_balance });

describe("передоплата учня в уроках", () => {
  it("учень без жодного поповнення в уроках — числа немає, а не нуль", () => {
    // Саме цей випадок і є «кожен учень»: картка мусить показати наступний
    // урок, а не вимогу грошей.
    expect(prepaidLessonBalance({ wallets: [], lessonTopups: [] })).toBeNull();
    expect(prepaidLessonBalance({ wallets: null, lessonTopups: null })).toBeNull();
  });

  it("лише ГРОШОВИЙ гаманець — теж не нуль: уроки в цій парі не рахуються", () => {
    // Гаманець є, але поповнень в уроках не було → lessons_balance 0 означає
    // «ця пара так не працює», а не «уроки закінчились».
    expect(prepaidLessonBalance({ wallets: [W("t1", 0)], lessonTopups: [] })).toBeNull();
  });

  it("передоплата в уроках є — показуємо справжній залишок", () => {
    expect(prepaidLessonBalance({ wallets: [W("t1", 4)], lessonTopups: [{ tutor_id: "t1" }] })).toBe(4);
  });

  it("залишок 0 у ПАРІ З ПЕРЕДОПЛАТОЮ — це справжнє «вичерпано»", () => {
    expect(prepaidLessonBalance({ wallets: [W("t1", 0)], lessonTopups: [{ tutor_id: "t1" }] })).toBe(0);
  });

  it("кілька репетиторів: рахуються лише пари з передоплатою в уроках", () => {
    const wallets = [W("t1", 3), W("t2", 9), W("t3", null)];
    // t2 платить грошима, t3 — рядок без числа; попереджаємо по t1.
    expect(prepaidLessonBalance({ wallets, lessonTopups: [{ tutor_id: "t1" }] })).toBe(3);
    expect(prepaidLessonBalance({ wallets, lessonTopups: [{ tutor_id: "t1" }, { tutor_id: "t2" }] })).toBe(12);
    // Пара з передоплатою, але без рядка балансу — 0, і це чесно «вичерпано».
    expect(prepaidLessonBalance({ wallets, lessonTopups: [{ tutor_id: "t3" }] })).toBe(0);
  });

  it("збій читання — null, інакше тимчасова помилка мережі просить грошей", () => {
    expect(
      prepaidLessonBalance({ wallets: [W("t1", 5)], lessonTopups: [{ tutor_id: "t1" }], readFailed: true }),
    ).toBeNull();
  });

  it("порожній tutor_id не створює пари з передоплатою", () => {
    expect(prepaidLessonBalance({ wallets: [W("t1", 2)], lessonTopups: [{ tutor_id: null }] })).toBeNull();
  });
});
