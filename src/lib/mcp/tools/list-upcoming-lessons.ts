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
  name: "list_upcoming_lessons",
  title: "List upcoming lessons",
  description:
    "List the signed-in user's upcoming lessons (default: next 14 days), ordered by start time.",
  inputSchema: {
    days_ahead: z.number().int().min(1).max(90).default(14).describe("How many days ahead to look."),
    limit: z.number().int().min(1).max(100).default(25),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days_ahead, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const now = new Date();
    const until = new Date(now.getTime() + days_ahead * 86400_000);
    const { data, error } = await supabaseForUser(ctx)
      .from("lessons")
      .select("id, starts_at, duration_minutes, subject, status, student_id, tutor_id, group_id")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", until.toISOString())
      .order("starts_at", { ascending: true })
      .limit(limit);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { lessons: data ?? [] },
    };
  },
});
