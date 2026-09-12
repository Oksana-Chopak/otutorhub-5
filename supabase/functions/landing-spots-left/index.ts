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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(200, { spotsLeft: TOTAL_FREE_SPOTS - 3, total: TOTAL_FREE_SPOTS });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Count registered tutors from user_roles
  const { count: tutorCount, error } = await admin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "tutor");

  const used = error ? 3 : (tutorCount ?? 0);
  const spotsLeft = Math.max(0, TOTAL_FREE_SPOTS - used);

  // Живі лічильники платформи для лендінгу (12.09): скільки зустрічей
  // помічник провів і про скільки оплат нагадав за 30 днів. Лише агрегати —
  // жодного імені, суми чи id; клієнт показує їх тільки коли числа вже не
  // соромні (поріг там), тож на старті смужка просто відсутня.
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [lessonsRes, remindersRes] = await Promise.all([
    admin.from("lessons").select("id", { count: "exact", head: true }).eq("status", "completed").gte("starts_at", since),
    admin.from("lesson_payment_reminders").select("id", { count: "exact", head: true }).gte("sent_at", since),
  ]);
  const stats = {
    lessonsCompleted30d: lessonsRes.error ? 0 : (lessonsRes.count ?? 0),
    remindersSent30d: remindersRes.error ? 0 : (remindersRes.count ?? 0),
    tutors: used,
  };
  return json(200, { spotsLeft, total: TOTAL_FREE_SPOTS, used, stats });
});
