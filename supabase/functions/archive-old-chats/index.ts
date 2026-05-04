import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);

    const { error, count } = await supabase
      .from("chat_messages")
      .update({ archived: true }, { count: "exact" })
      .lt("created_at", cutoff.toISOString())
      .eq("archived", false);

    if (error) {
      console.error("archive-old-chats error", error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`archive-old-chats: archived ${count ?? 0} messages older than ${cutoff.toISOString()}`);

    return new Response(
      JSON.stringify({ ok: true, archived: count ?? 0, cutoff: cutoff.toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("archive-old-chats fatal", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
