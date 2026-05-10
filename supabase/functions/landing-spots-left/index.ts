import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TOTAL_FREE_SPOTS = 20;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(200, { spotsLeft: TOTAL_FREE_SPOTS, total: TOTAL_FREE_SPOTS });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { count, error } = await admin
    .from("tutor_referral_requests")
    .select("id", { count: "exact", head: true })
    .eq("source", "landing_quiz")
    .gte("created_at", since.toISOString());

  const used = error ? 0 : count ?? 0;
  const spotsLeft = Math.max(0, TOTAL_FREE_SPOTS - used);

  return json(200, { spotsLeft, total: TOTAL_FREE_SPOTS });
});
