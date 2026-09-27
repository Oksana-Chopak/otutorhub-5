import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_pending_payments",
  title: "List pending payments",
  // 27.09: фільтр стояв на статусі "pending", якого в домені НЕМАЄ
  // (student_payment_status = 'paid' | 'unpaid'), тож інструмент ЗАВЖДИ
  // повертав порожньо — і виглядало це як «боргів немає».
  description:
    "List lessons where the student payment is still unpaid — visible to the signed-in user via RLS. Includes both conducted lessons (a real debt) and future unpaid ones (expected payment); the view carries no lesson status, so the caller decides.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("lesson_details_student")
      .select("lesson_id, student_price, student_payment_status, student_paid_at, is_cancellation_fee")
      .eq("student_payment_status", "unpaid")
      .limit(limit);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { pending: data ?? [] },
    };
  },
});
