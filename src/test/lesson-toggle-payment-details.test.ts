/**
 * Тест: togglePaymentStatus має перемикати student_payment_status
 * у таблиці lesson_details (а НЕ у lessons).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";

async function togglePaymentStatus(lessonId: string, current: "paid" | "unpaid") {
  const next = current === "paid" ? "unpaid" : "paid";
  const { data, error } = await supabase
    .from("lesson_details")
    .update({ student_payment_status: next })
    .eq("lesson_id", lessonId)
    .select("lesson_id, student_payment_status")
    .single();
  return { data, error, next };
}

describe("togglePaymentStatus у lesson_details", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockChain(returned: any) {
    const single = vi.fn().mockResolvedValue(returned);
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    (supabase.from as any).mockReturnValue({ update });
    return { update, eq };
  }

  it("звертається саме до lesson_details, а не до lessons", async () => {
    mockChain({
      data: { lesson_id: "l1", student_payment_status: "paid" },
      error: null,
    });
    await togglePaymentStatus("l1", "unpaid");
    expect(supabase.from).toHaveBeenCalledWith("lesson_details");
    expect(supabase.from).not.toHaveBeenCalledWith("lessons");
  });

  it("перемикає unpaid → paid", async () => {
    const { update, eq } = mockChain({
      data: { lesson_id: "l1", student_payment_status: "paid" },
      error: null,
    });
    const { data, next, error } = await togglePaymentStatus("l1", "unpaid");
    expect(update).toHaveBeenCalledWith({ student_payment_status: "paid" });
    expect(eq).toHaveBeenCalledWith("lesson_id", "l1");
    expect(next).toBe("paid");
    expect(error).toBeNull();
    expect(data?.student_payment_status).toBe("paid");
  });

  it("перемикає paid → unpaid", async () => {
    const { update } = mockChain({
      data: { lesson_id: "l1", student_payment_status: "unpaid" },
      error: null,
    });
    const { data, next } = await togglePaymentStatus("l1", "paid");
    expect(update).toHaveBeenCalledWith({ student_payment_status: "unpaid" });
    expect(next).toBe("unpaid");
    expect(data?.student_payment_status).toBe("unpaid");
  });
});
