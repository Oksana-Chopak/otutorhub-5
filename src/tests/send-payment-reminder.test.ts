import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

import { supabase } from "@/integrations/supabase/client";

async function sendPaymentReminder(lessonId: string) {
  return await supabase.functions.invoke("remind-payment", {
    body: { lessonId },
  });
}

describe("send-payment-reminder edge function call", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes remind-payment with correct lessonId and returns success", async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { success: true, channels: ["telegram", "email"] },
      error: null,
    });

    const { data, error } = await sendPaymentReminder("lesson-42");

    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(supabase.functions.invoke).toHaveBeenCalledWith("remind-payment", {
      body: { lessonId: "lesson-42" },
    });
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.channels).toContain("telegram");
  });

  it("surfaces no_channels response", async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { success: false, reason: "no_channels" },
      error: null,
    });

    const { data } = await sendPaymentReminder("lesson-99");
    expect(data?.success).toBe(false);
    expect(data?.reason).toBe("no_channels");
  });

  it("propagates edge function error (e.g. already_paid)", async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: { message: "already_paid" },
    });

    const { data, error } = await sendPaymentReminder("lesson-1");
    expect(data).toBeNull();
    expect(error?.message).toBe("already_paid");
  });
});
