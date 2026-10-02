// errors-report — помилки за добу групами для щоденної рутини в GitHub (02.10).
// Кличе воркфлоу .github/workflows/errors-daily.yml із CRON_SECRET; віддає
// JSON груп (error_groups: нові першими) і кількість. Нічого не змінює.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { versionProbe } from "../_shared/build.ts";
import { withErrorLog } from "../_shared/errorLog.ts";

Deno.serve(withErrorLog("errors-report", async (req) => {
  const probe = versionProbe(req, "errors-report");
  if (probe) return probe;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const provided = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: expected } = await sb.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const hours = Math.min(Math.max(Number(new URL(req.url).searchParams.get("hours") ?? 24) || 24, 1), 168);
  const { data, error } = await (sb.rpc as any)("error_groups", { _hours: hours, _limit: 50 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  const groups = Array.isArray(data) ? data : [];
  return new Response(JSON.stringify({ hours, total: groups.length, new: groups.filter((g: any) => g.is_new).length, groups }), {
    headers: { "Content-Type": "application/json" },
  });
}));
