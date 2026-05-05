import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";

// Replicates the togglePayment logic used across the app:
// flips student_payment_status between "paid" and "unpaid" via lesson_details upsert.
async function togglePayment(lessonId: string, current: "paid" | "unpaid") {
  const next = current === "paid" ? "unpaid" : "paid";
  const { data, error } = await (supabase as any)
    .from("lesson_details")
    .upsert({ lesson_id: lessonId, student_payment_status: next }, { onConflict: "lesson_id" })
    .select("lesson_id, student_payment_status")
    .single();
  return { data, error, next };
}

describe("Lesson togglePayment flow", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockUpsertChain(returned: any) {
    const single = vi.fn().mockResolvedValue(returned);
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select }));
    (supabase.from as any).mockReturnValue({ upsert });
    return { upsert, select, single };
  }

  it("flips unpaid → paid", async () => {
    const { upsert } = mockUpsertChain({
      data: { lesson_id: "l1", student_payment_status: "paid" },
      error: null,
    });

    const { data, next, error } = await togglePayment("l1", "unpaid");

    expect(supabase.from).toHaveBeenCalledWith("lesson_details");
    expect(upsert).toHaveBeenCalledWith(
      { lesson_id: "l1", student_payment_status: "paid" },
      { onConflict: "lesson_id" }
    );
    expect(next).toBe("paid");
    expect(error).toBeNull();
    expect((data as any)?.student_payment_status).toBe("paid");
  });

  it("flips paid → unpaid", async () => {
    const { upsert } = mockUpsertChain({
      data: { lesson_id: "l1", student_payment_status: "unpaid" },
      error: null,
    });

    const { data, next } = await togglePayment("l1", "paid");

    expect(upsert).toHaveBeenCalledWith(
      { lesson_id: "l1", student_payment_status: "unpaid" },
      { onConflict: "lesson_id" }
    );
    expect(next).toBe("unpaid");
    expect((data as any)?.student_payment_status).toBe("unpaid");
  });

  it("returns error when supabase upsert fails", async () => {
    mockUpsertChain({ data: null, error: { message: "permission denied" } });

    const { error, data } = await togglePayment("l1", "unpaid");
    expect(data).toBeNull();
    expect(error?.message).toBe("permission denied");
  });
});
