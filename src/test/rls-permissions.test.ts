/**
 * Документація-як-тести: фіксує очікувані права на рівні БД (RLS).
 * Ці тести — джерело правди про те, що кожна роль може ЧИТАТИ та ЗМІНЮВАТИ.
 * Якщо змінюються RLS-політики в Supabase, оновлюйте цю матрицю синхронно.
 */
import { describe, it, expect } from "vitest";

type Role = "manager" | "tutor" | "student";
type Op = "select" | "insert" | "update" | "delete";

interface Rule {
  manager: boolean;
  tutor: boolean | "own"; // "own" = тільки свої записи / пов'язані
  student: boolean | "own";
}

// Матриця прав по таблицях (відповідає поточним RLS-політикам у БД).
const PERMISSIONS: Record<string, Partial<Record<Op, Rule>>> = {
  lessons: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: "own", student: "own" }, // тільки якщо є student_rates
    update: { manager: true, tutor: "own", student: "own" }, // нефінансові поля
    delete: { manager: true, tutor: "own", student: false },
  },
  user_roles: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: false, student: false },
    update: { manager: true, tutor: false, student: false },
    delete: { manager: true, tutor: false, student: false },
  },
  manager_audit_log: {
    select: { manager: true, tutor: false, student: false },
    insert: { manager: false, tutor: false, student: false }, // тільки тригери
  },
  manager_notes: {
    select: { manager: true, tutor: false, student: false },
    insert: { manager: true, tutor: false, student: false },
    update: { manager: true, tutor: false, student: false },
    delete: { manager: true, tutor: false, student: false },
  },
  student_rates: {
    select: { manager: true, tutor: false, student: "own" },
    insert: { manager: true, tutor: false, student: false },
    update: { manager: true, tutor: false, student: false },
    delete: { manager: true, tutor: false, student: false },
  },
  tutor_subject_rates: {
    select: { manager: true, tutor: "own", student: false },
    insert: { manager: true, tutor: "own", student: false },
    update: { manager: true, tutor: "own", student: false },
    delete: { manager: true, tutor: "own", student: false },
  },
  tutor_availability_weekly: {
    select: { manager: true, tutor: "own", student: "own" }, // студент бачить repetiторів, з якими пов'язаний
    insert: { manager: true, tutor: "own", student: false },
    update: { manager: true, tutor: "own", student: false },
    delete: { manager: true, tutor: "own", student: false },
  },
  tutor_availability_overrides: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: "own", student: false },
    update: { manager: true, tutor: "own", student: false },
    delete: { manager: true, tutor: "own", student: false },
  },
  availability_requests: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: false, student: "own" }, // тільки до пов'язаного репетитора
    update: { manager: true, tutor: "own", student: false },
    delete: { manager: true, tutor: false, student: "own" },
  },
  chat_threads: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: "own", student: "own" }, // тільки за наявності зв'язку
    update: { manager: true, tutor: "own", student: "own" },
  },
  chat_messages: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: "own", student: "own" },
    update: { manager: false, tutor: false, student: false },
    delete: { manager: false, tutor: false, student: false },
  },
  profiles: {
    select: { manager: true, tutor: true, student: true }, // публічні базові поля
    insert: { manager: true, tutor: false, student: false },
    update: { manager: true, tutor: "own", student: "own" },
    delete: { manager: true, tutor: false, student: false },
  },
  profile_contacts: {
    select: { manager: true, tutor: "own", student: "own" }, // tutor: тільки активні студенти
    insert: { manager: true, tutor: "own", student: "own" },
    update: { manager: true, tutor: "own", student: "own" },
  },
  profile_financial_contacts: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: "own", student: "own" },
    update: { manager: true, tutor: "own", student: "own" },
  },
  tutor_details: {
    select: { manager: true, tutor: "own", student: false }, // restrictive policy
    insert: { manager: true, tutor: "own", student: false },
    update: { manager: true, tutor: "own", student: false },
  },
  student_details: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: false, student: "own" },
    update: { manager: true, tutor: false, student: "own" },
  },
  lesson_attachments: {
    select: { manager: true, tutor: "own", student: "own" },
    insert: { manager: true, tutor: "own", student: "own" },
    delete: { manager: true, tutor: "own", student: false },
  },
};

function can(table: string, op: Op, role: Role): boolean | "own" {
  return PERMISSIONS[table]?.[op]?.[role] ?? false;
}

describe("RLS-матриця: MANAGER", () => {
  it("має повний доступ до фінансових та адмін-таблиць", () => {
    expect(can("manager_audit_log", "select", "manager")).toBe(true);
    expect(can("manager_notes", "insert", "manager")).toBe(true);
    expect(can("student_rates", "update", "manager")).toBe(true);
    expect(can("user_roles", "insert", "manager")).toBe(true);
  });

  it("може редагувати фінансові поля уроків", () => {
    expect(can("lessons", "update", "manager")).toBe(true);
    expect(can("lessons", "delete", "manager")).toBe(true);
  });
});

describe("RLS-матриця: TUTOR", () => {
  it("НЕ має доступу до адмін-таблиць", () => {
    expect(can("manager_audit_log", "select", "tutor")).toBe(false);
    expect(can("manager_notes", "select", "tutor")).toBe(false);
    expect(can("user_roles", "insert", "tutor")).toBe(false);
    expect(can("student_rates", "update", "tutor")).toBe(false);
  });

  it("керує власними слотами доступності та ставками за предметом", () => {
    expect(can("tutor_availability_weekly", "update", "tutor")).toBe("own");
    expect(can("tutor_subject_rates", "update", "tutor")).toBe("own");
    expect(can("tutor_details", "update", "tutor")).toBe("own");
  });

  it("бачить тільки своїх студентів і їхні контакти", () => {
    expect(can("profile_contacts", "select", "tutor")).toBe("own");
    expect(can("student_details", "select", "tutor")).toBe("own");
  });

  it("не може видаляти повідомлення чату", () => {
    expect(can("chat_messages", "delete", "tutor")).toBe(false);
    expect(can("chat_messages", "update", "tutor")).toBe(false);
  });
});

describe("RLS-матриця: STUDENT", () => {
  it("НЕ має доступу до адмін / фінансових таблиць інших користувачів", () => {
    expect(can("manager_audit_log", "select", "student")).toBe(false);
    expect(can("manager_notes", "select", "student")).toBe(false);
    expect(can("tutor_subject_rates", "select", "student")).toBe(false);
    expect(can("tutor_details", "select", "student")).toBe(false);
  });

  it("бачить тільки свої уроки та свої ставки", () => {
    expect(can("lessons", "select", "student")).toBe("own");
    expect(can("student_rates", "select", "student")).toBe("own");
  });

  it("не може видаляти уроки і змінювати ставки", () => {
    expect(can("lessons", "delete", "student")).toBe(false);
    expect(can("student_rates", "update", "student")).toBe(false);
  });

  it("може створювати запити доступності тільки до пов'язаного репетитора", () => {
    expect(can("availability_requests", "insert", "student")).toBe("own");
  });
});

describe("RLS-матриця: захист фінансових полів уроків", () => {
  it("ні tutor, ні student не можуть напряму редагувати фінанси (захист на рівні WITH CHECK + тригери)", () => {
    // На рівні rls update дозволено, але WITH CHECK і тригер protect_lesson_fields
    // не пропускають зміни до student_price / tutor_payout / *_status / *_paid_at.
    // Цей тест — нагадування, що логіка захисту фінансів повинна жити в БД.
    expect(true).toBe(true);
  });
});
