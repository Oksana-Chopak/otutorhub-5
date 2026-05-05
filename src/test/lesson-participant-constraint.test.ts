/**
 * Тест: CHECK lessons_participant_check на таблиці lessons.
 * - lesson_type='individual' БЕЗ student_id → помилка
 * - lesson_type='group' БЕЗ group_id → помилка
 * Симулюємо поведінку Postgres через мок Supabase клієнта.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";

const CONSTRAINT_ERROR = {
  code: "23514",
  message:
    'new row for relation "lessons" violates check constraint "lessons_participant_check"',
};

function mockLessonsInsert() {
  (supabase.from as any).mockImplementation((table: string) => {
    if (table !== "lessons") throw new Error(`unexpected table: ${table}`);
    return {
      insert: (payload: any) => ({
        select: () => ({
          single: () => {
            const lt = payload.lesson_type;
            const hasStudent = !!payload.student_id;
            const hasGroup = !!payload.group_id;
            const valid =
              (lt === "individual" && hasStudent && !hasGroup) ||
              ((lt === "pair" || lt === "group") && hasGroup);
            if (!valid) return Promise.resolve({ data: null, error: CONSTRAINT_ERROR });
            return Promise.resolve({ data: { id: "lesson-ok", ...payload }, error: null });
          },
        }),
      }),
    };
  });
}

async function insertLesson(payload: Record<string, any>) {
  return await supabase.from("lessons").insert(payload as any).select().single();
}

describe("CHECK lessons_participant_check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLessonsInsert();
  });

  it("individual без student_id → помилка constraint", async () => {
    const { data, error } = await insertLesson({
      tutor_id: "tutor-1",
      lesson_type: "individual",
      student_id: null,
      group_id: null,
      subject: "Math",
      starts_at: "2026-05-10T10:00:00.000Z",
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/lessons_participant_check/);
  });

  it("group без group_id → помилка constraint", async () => {
    const { data, error } = await insertLesson({
      tutor_id: "tutor-1",
      lesson_type: "group",
      student_id: null,
      group_id: null,
      subject: "Math",
      starts_at: "2026-05-10T10:00:00.000Z",
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/lessons_participant_check/);
  });

  it("individual зі student_id → ок", async () => {
    const { data, error } = await insertLesson({
      tutor_id: "tutor-1",
      lesson_type: "individual",
      student_id: "student-1",
      group_id: null,
      subject: "Math",
      starts_at: "2026-05-10T10:00:00.000Z",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ lesson_type: "individual", student_id: "student-1" });
  });

  it("group з group_id → ок", async () => {
    const { data, error } = await insertLesson({
      tutor_id: "tutor-1",
      lesson_type: "group",
      student_id: null,
      group_id: "group-1",
      subject: "Math",
      starts_at: "2026-05-10T10:00:00.000Z",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ lesson_type: "group", group_id: "group-1" });
  });
});
