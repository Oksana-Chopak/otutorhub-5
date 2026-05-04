import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";

// Replicates the togglePayment logic used across the app:
// flips student_payment_status between "paid" and "unpaid".
async function togglePayment(lessonId: string, current: "paid" | "unpaid") {
  const next = current === "paid" ? "unpaid" : "paid";
  const { data, error } = await supabase
    .from("lessons")
    .update({ student_payment_status: next })
    .eq("id", lessonId)
    .select("id, student_payment_status")
    .single();
  return { data, error, next };
}

describe("Lesson togglePayment flow", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockUpdateChain(returned: any) {
    const single = vi.fn().mockResolvedValue(returned);
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    (supabase.from as any).mockReturnValue({ update });
    return { update, eq, select, single };
  }

  it("flips unpaid → paid", async () => {
    const { update, eq } = mockUpdateChain({
      data: { id: "l1", student_payment_status: "paid" },
      error: null,
    });

    const { data, next, error } = await togglePayment("l1", "unpaid");

    expect(supabase.from).toHaveBeenCalledWith("lessons");
    expect(update).toHaveBeenCalledWith({ student_payment_status: "paid" });
    expect(eq).toHaveBeenCalledWith("id", "l1");
    expect(next).toBe("paid");
    expect(error).toBeNull();
    expect(data?.student_payment_status).toBe("paid");
  });

  it("flips paid → unpaid", async () => {
    const { update } = mockUpdateChain({
      data: { id: "l1", student_payment_status: "unpaid" },
      error: null,
    });

    const { data, next } = await togglePayment("l1", "paid");

    expect(update).toHaveBeenCalledWith({ student_payment_status: "unpaid" });
    expect(next).toBe("unpaid");
    expect(data?.student_payment_status).toBe("unpaid");
  });

  it("returns error when supabase update fails", async () => {
    mockUpdateChain({ data: null, error: { message: "permission denied" } });

    const { error, data } = await togglePayment("l1", "unpaid");
    expect(data).toBeNull();
    expect(error?.message).toBe("permission denied");
  });
});
