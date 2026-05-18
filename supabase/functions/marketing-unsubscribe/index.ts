// Public endpoint to handle one-click marketing unsubscribes
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let token: string | null = null;
    if (req.method === "GET") {
      token = new URL(req.url).searchParams.get("token");
    } else {
      const body = await req.json().catch(() => ({}));
      token = body?.token ?? null;
    }
    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tok } = await admin
      .from("marketing_unsubscribe_tokens")
      .select("email")
      .eq("token", token)
      .maybeSingle();
    if (!tok) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET") {
      const { data: already } = await admin
        .from("marketing_unsubscribes")
        .select("email").eq("email", tok.email).maybeSingle();
      return new Response(JSON.stringify({ email: tok.email, alreadyUnsubscribed: !!already }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST: confirm unsubscribe
    await admin.from("marketing_unsubscribes")
      .upsert({ email: tok.email, reason: "user_clicked" }, { onConflict: "email" });

    // Also flip marketing_opt_in to false for matching tutor (best effort)
    const { data: profileMatch } = await admin
      .from("profile_contacts").select("user_id").eq("email", tok.email).maybeSingle();
    if (profileMatch?.user_id) {
      await admin.from("tutor_workspace_settings")
        .update({ marketing_opt_in: false })
        .eq("tutor_id", profileMatch.user_id);
    }

    return new Response(JSON.stringify({ ok: true, email: tok.email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("marketing-unsubscribe error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
