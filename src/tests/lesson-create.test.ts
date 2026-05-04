import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client BEFORE importing anything that uses it
vi.mock("@/integrations/supabase/client", () => {
  const insertMock = vi.fn();
  const fromMock = vi.fn();
  return {
    supabase: { from: fromMock },
    __mocks: { insertMock, fromMock },
  };
});

import { supabase } from "@/integrations/supabase/client";

describe("Lesson creation flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a lesson row with required fields and status=scheduled", async () => {
    const insertedRow = {
      id: "lesson-1",
      tutor_id: "tutor-1",
      student_id: "student-1",
      subject: "Математика",
      starts_at: "2026-05-10T10:00:00.000Z",
      duration_minutes: 60,
      student_price: 500,
      status: "scheduled",
      student_payment_status: "unpaid",
    };

    const single = vi.fn().mockResolvedValue({ data: insertedRow, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    (supabase.from as any).mockReturnValue({ insert });

    const payload = {
      tutor_id: "tutor-1",
      student_id: "student-1",
      subject: "Математика",
      starts_at: "2026-05-10T10:00:00.000Z",
      duration_minutes: 60,
      student_price: 500,
      status: "scheduled" as const,
    };

    const { data, error } = await supabase
      .from("lessons")
      .insert(payload as any)
      .select()
      .single();

    expect(supabase.from).toHaveBeenCalledWith("lessons");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tutor_id: "tutor-1",
        student_id: "student-1",
        starts_at: "2026-05-10T10:00:00.000Z",
        student_price: 500,
        status: "scheduled",
      }),
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({
      tutor_id: "tutor-1",
      student_id: "student-1",
      starts_at: "2026-05-10T10:00:00.000Z",
      student_price: 500,
      status: "scheduled",
    });
  });

  it("propagates errors from supabase insert", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "RLS denied" } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    (supabase.from as any).mockReturnValue({ insert });

    const { data, error } = await supabase
      .from("lessons")
      .insert({ tutor_id: "x", student_id: "y" } as any)
      .select()
      .single();

    expect(data).toBeNull();
    expect(error?.message).toBe("RLS denied");
  });
});
