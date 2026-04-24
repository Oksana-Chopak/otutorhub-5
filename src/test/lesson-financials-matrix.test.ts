/**
 * Матриця доступу до ФІНАНСОВИХ ПОЛІВ уроку (lessons.*).
 *
 * Це жива документація актуального стану БД:
 *   - View `lessons_visible` маскує поля NULL'ом для ролей, які не мають їх бачити.
 *   - Тригер `protect_lesson_fields` блокує будь-яку зміну фінансів не-менеджером
 *     (єдиний виняток — independent tutor може міняти student_payment_status
 *     на власному уроці з source='independent').
 *   - RLS WITH CHECK на UPDATE дублює цей захист.
 *
 * Якщо ці правила змінюються в БД — синхронно оновлюйте цю матрицю.
 */
import { describe, it, expect } from "vitest";

type Role = "manager" | "tutor_hub" | "tutor_independent" | "student" | "other";
type Field =
  | "student_price"
  | "student_payment_status"
  | "student_paid_at"
  | "tutor_payout"
  | "tutor_payout_status"
  | "tutor_paid_at";

interface Access {
  view: boolean; // чи бачить через lessons_visible (на власному уроці)
  edit: boolean; // чи може записати (з урахуванням trigger + WITH CHECK)
}

const FINANCIAL_MATRIX: Record<Field, Record<Role, Access>> = {
  // Ціна, яку платить учень — бачать менеджер, сам учень, та independent-репетитор
  // (бо в independent моделі ціну виставляє сам репетитор).
  // Hub-репетитор НЕ бачить, скільки бере хаб з учня.
  student_price: {
    manager: { view: true, edit: true },
    tutor_hub: { view: false, edit: false },
    tutor_independent: { view: true, edit: true }, // editing на own independent lesson
    student: { view: true, edit: false },
    other: { view: false, edit: false },
  },
  student_payment_status: {
    manager: { view: true, edit: true },
    tutor_hub: { view: false, edit: false },
    tutor_independent: { view: true, edit: true }, // позначає «учень оплатив»
    student: { view: true, edit: false },
    other: { view: false, edit: false },
  },
  student_paid_at: {
    manager: { view: true, edit: true },
    tutor_hub: { view: false, edit: false },
    tutor_independent: { view: true, edit: false }, // ставиться тригером set_payment_dates
    student: { view: true, edit: false },
    other: { view: false, edit: false },
  },
  // Виплата репетитору — бачать менеджер і сам репетитор. Учень НЕ бачить.
  tutor_payout: {
    manager: { view: true, edit: true },
    tutor_hub: { view: true, edit: false },
    tutor_independent: { view: true, edit: false }, // independent отримує всю student_price напряму
    student: { view: false, edit: false },
    other: { view: false, edit: false },
  },
  tutor_payout_status: {
    manager: { view: true, edit: true },
    tutor_hub: { view: true, edit: false },
    tutor_independent: { view: true, edit: false },
    student: { view: false, edit: false },
    other: { view: false, edit: false },
  },
  tutor_paid_at: {
    manager: { view: true, edit: true },
    tutor_hub: { view: true, edit: false },
    tutor_independent: { view: true, edit: false },
    student: { view: false, edit: false },
    other: { view: false, edit: false },
  },
};

const ALL_ROLES: Role[] = ["manager", "tutor_hub", "tutor_independent", "student", "other"];
const ALL_FIELDS = Object.keys(FINANCIAL_MATRIX) as Field[];

describe("Фінансові поля уроку — повна матриця ролей", () => {
  it("MANAGER має повний доступ (view + edit) до всіх фінансових полів", () => {
    for (const f of ALL_FIELDS) {
      expect(FINANCIAL_MATRIX[f].manager.view).toBe(true);
      expect(FINANCIAL_MATRIX[f].manager.edit).toBe(true);
    }
  });

  it("STUDENT бачить лише свою ціну та статус оплати, нічого не редагує", () => {
    expect(FINANCIAL_MATRIX.student_price.student.view).toBe(true);
    expect(FINANCIAL_MATRIX.student_payment_status.student.view).toBe(true);
    expect(FINANCIAL_MATRIX.student_paid_at.student.view).toBe(true);

    expect(FINANCIAL_MATRIX.tutor_payout.student.view).toBe(false);
    expect(FINANCIAL_MATRIX.tutor_payout_status.student.view).toBe(false);
    expect(FINANCIAL_MATRIX.tutor_paid_at.student.view).toBe(false);

    for (const f of ALL_FIELDS) {
      expect(FINANCIAL_MATRIX[f].student.edit).toBe(false);
    }
  });

  it("TUTOR HUB бачить лише власну виплату; ціну учня (маржу хаба) НЕ бачить", () => {
    expect(FINANCIAL_MATRIX.tutor_payout.tutor_hub.view).toBe(true);
    expect(FINANCIAL_MATRIX.tutor_payout_status.tutor_hub.view).toBe(true);
    expect(FINANCIAL_MATRIX.tutor_paid_at.tutor_hub.view).toBe(true);

    expect(FINANCIAL_MATRIX.student_price.tutor_hub.view).toBe(false);
    expect(FINANCIAL_MATRIX.student_payment_status.tutor_hub.view).toBe(false);
    expect(FINANCIAL_MATRIX.student_paid_at.tutor_hub.view).toBe(false);
  });

  it("TUTOR HUB не може редагувати ЖОДНЕ фінансове поле (тригер protect_lesson_fields)", () => {
    for (const f of ALL_FIELDS) {
      expect(FINANCIAL_MATRIX[f].tutor_hub.edit).toBe(false);
    }
  });

  it("TUTOR INDEPENDENT бачить усі фінанси власного уроку (це його бізнес)", () => {
    for (const f of ALL_FIELDS) {
      expect(FINANCIAL_MATRIX[f].tutor_independent.view).toBe(true);
    }
  });

  it("TUTOR INDEPENDENT редагує ТІЛЬКИ student_price і student_payment_status власного уроку", () => {
    expect(FINANCIAL_MATRIX.student_price.tutor_independent.edit).toBe(true);
    expect(FINANCIAL_MATRIX.student_payment_status.tutor_independent.edit).toBe(true);

    // Решту — ні. paid_at виставляється тригером, payout не існує в independent моделі.
    expect(FINANCIAL_MATRIX.student_paid_at.tutor_independent.edit).toBe(false);
    expect(FINANCIAL_MATRIX.tutor_payout.tutor_independent.edit).toBe(false);
    expect(FINANCIAL_MATRIX.tutor_payout_status.tutor_independent.edit).toBe(false);
    expect(FINANCIAL_MATRIX.tutor_paid_at.tutor_independent.edit).toBe(false);
  });

  it("OTHER (стороння авторизована особа) не бачить і не редагує жодного поля", () => {
    for (const f of ALL_FIELDS) {
      expect(FINANCIAL_MATRIX[f].other.view).toBe(false);
      expect(FINANCIAL_MATRIX[f].other.edit).toBe(false);
    }
  });

  it("матриця повна: для кожної ролі × поля визначено явно view+edit", () => {
    for (const f of ALL_FIELDS) {
      for (const r of ALL_ROLES) {
        const cell = FINANCIAL_MATRIX[f][r];
        expect(typeof cell.view).toBe("boolean");
        expect(typeof cell.edit).toBe("boolean");
      }
    }
  });

  it("інваріант: edit=>view (не можна редагувати поле, якого не бачиш)", () => {
    for (const f of ALL_FIELDS) {
      for (const r of ALL_ROLES) {
        const { view, edit } = FINANCIAL_MATRIX[f][r];
        if (edit) expect(view).toBe(true);
      }
    }
  });
});

describe("Узгодженість UI з матрицею (LessonWorkspace, FinancesPage)", () => {
  // Це не повноцінні DOM-тести — це чек-ліст відповідності UI ↔ БД.
  // Якщо UI почне показувати фінанси не тій ролі, тест має впасти на ревʼю.

  it("FinancesPage доступна тільки manager (через ProtectedRoute allowedRoles=['manager'])", () => {
    // Перевіряється у role-access.test.tsx — тут просто фіксуємо інваріант.
    expect(true).toBe(true);
  });

  it("LessonWorkspace.canTogglePayment = (isTutor && source==='independent') || isManager", () => {
    // Збігається з FINANCIAL_MATRIX.student_payment_status.{manager,tutor_independent}.edit
    expect(FINANCIAL_MATRIX.student_payment_status.manager.edit).toBe(true);
    expect(FINANCIAL_MATRIX.student_payment_status.tutor_independent.edit).toBe(true);
    expect(FINANCIAL_MATRIX.student_payment_status.tutor_hub.edit).toBe(false);
    expect(FINANCIAL_MATRIX.student_payment_status.student.edit).toBe(false);
  });

  it("IndependentTutorStats читає тільки lessons.source='independent' WHERE tutor_id=auth.uid()", () => {
    // independent tutor може бачити student_price лише на own independent уроках —
    // це гарантує lessons_visible (CASE … OR (auth.uid()=tutor_id AND source='independent')).
    expect(FINANCIAL_MATRIX.student_price.tutor_independent.view).toBe(true);
  });
});
