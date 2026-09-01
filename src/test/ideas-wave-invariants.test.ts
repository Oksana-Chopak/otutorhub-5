import { describe, expect, it } from "vitest";
import { countLessonsMissingPrice } from "@/lib/financials";

/**
 * Інваріанти хвиль F1-F4 (ідеї 01.09). Дванадцять фіч приїхали без жодного
 * тесту; тут закриті ті, де вже стався реальний баг або де ціна помилки —
 * гроші чи брехня користувачу.
 */

describe("задача «уроки без ціни» — лише самостійному репетитору", () => {
  // Для хабового `lessons_visible` маскує student_price у NULL (він не має
  // права бачити гроші школи). `Number(null) === 0`, тож без прапора КОЖЕН
  // його урок рахувався «без ціни» — і задача вела в список, який він
  // однаково не може виправити. Саме це й сталося при вмиканні smartTasks.
  const hubLessons = [
    { student_id: "s1", status: "scheduled", student_price: null, tutor_payout: 500, source: "hub" },
    { student_id: "s2", status: "completed", student_price: null, tutor_payout: 500, source: "hub" },
  ];

  it("хабовий репетитор не отримує жодної такої задачі, хоч ціни й замасковані", () => {
    expect(countLessonsMissingPrice(hubLessons, { isIndependent: false })).toBe(0);
  });

  it("самостійний бачить рівно свої уроки без ціни", () => {
    const rows = [
      { student_id: "s1", status: "scheduled", student_price: 0, source: "independent" },
      { student_id: "s2", status: "completed", student_price: 400, source: "independent" },
      { student_id: "s3", status: "cancelled", student_price: 0, source: "independent" },
    ];
    expect(countLessonsMissingPrice(rows, { isIndependent: true })).toBe(1);
  });

  it("групові уроки не рахуються — їхня ціна живе на учасниках", () => {
    const rows = [{ student_id: null, status: "scheduled", student_price: 0, source: "independent" }];
    expect(countLessonsMissingPrice(rows, { isIndependent: true })).toBe(0);
  });

  it("нульова виплата не робить самостійний урок «без ціни» — у нього її й не буває", () => {
    const rows = [
      { student_id: "s1", status: "scheduled", student_price: 500, tutor_payout: 0, source: "independent" },
    ];
    expect(countLessonsMissingPrice(rows, { isIndependent: true })).toBe(0);
  });
});
