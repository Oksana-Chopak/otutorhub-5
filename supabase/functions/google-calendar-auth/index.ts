// Initiates Google Calendar OAuth flow.
// GET /functions/v1/google-calendar-auth?user_id={uuid}

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const REDIRECT_URI =
  "https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/google-calendar-callback";
const SCOPE = "https://www.googleapis.com/auth/calendar.events email";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!clientId) {
    return new Response(JSON.stringify({ error: "GOOGLE_CLIENT_ID not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: userId,
    include_granted_scopes: "true",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    302,
  );
});
