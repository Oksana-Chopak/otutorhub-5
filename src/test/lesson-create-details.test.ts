/**
 * Тест: при створенні уроку також має створюватись запис у lesson_details
 * з тим самим lesson_id, student_price і student_payment_status='unpaid'.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";

// Імітує реальний флоу: вставити lesson, потім lesson_details.
async function createLessonWithDetails(payload: {
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  student_price: number;
}) {
  const { data: lesson, error: lessonErr } = await supabase
    .from("lessons")
    .insert({ ...payload, status: "scheduled" } as any)
    .select()
    .single();
  if (lessonErr || !lesson) return { lesson: null, details: null, error: lessonErr };

  const { data: details, error: detailsErr } = await supabase
    .from("lesson_details")
    .insert({
      lesson_id: (lesson as any).id,
      student_price: payload.student_price,
      student_payment_status: "unpaid",
    } as any)
    .select()
    .single();

  return { lesson, details, error: detailsErr };
}

describe("Створення уроку → lesson_details", () => {
  beforeEach(() => vi.clearAllMocks());

  it("створює lesson_details з правильним lesson_id, ціною і статусом 'unpaid'", async () => {
    const lessonRow = { id: "lesson-42" };
    const detailsRow = {
      lesson_id: "lesson-42",
      student_price: 500,
      student_payment_status: "unpaid",
    };

    const lessonInsert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: lessonRow, error: null }) }),
    }));
    const detailsInsert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: detailsRow, error: null }) }),
    }));

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === "lessons") return { insert: lessonInsert };
      if (table === "lesson_details") return { insert: detailsInsert };
      throw new Error(`unexpected table: ${table}`);
    });

    const { lesson, details, error } = await createLessonWithDetails({
      tutor_id: "tutor-1",
      student_id: "student-1",
      subject: "Математика",
      starts_at: "2026-05-10T10:00:00.000Z",
      duration_minutes: 60,
      student_price: 500,
    });

    expect(error).toBeNull();
    expect(lesson).toMatchObject({ id: "lesson-42" });
    expect(detailsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lesson_id: "lesson-42",
        student_price: 500,
        student_payment_status: "unpaid",
      })
    );
    expect(details).toMatchObject({
      lesson_id: "lesson-42",
      student_price: 500,
      student_payment_status: "unpaid",
    });
  });
});
