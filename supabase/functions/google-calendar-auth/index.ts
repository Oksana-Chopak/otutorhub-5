// Initiates Google Calendar OAuth flow.
// GET /functions/v1/google-calendar-auth?user_id={uuid}

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const REDIRECT_URI =
  "https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/google-calendar-callback";
const SCOPE = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const DEFAULT_RETURN_TO = "https://otutorhub.com/profile";

function safeReturnTo(value: string | null) {
  if (!value) return DEFAULT_RETURN_TO;
  try {
    const url = new URL(value);
    const isAllowedHost =
      url.hostname === "otutorhub.com" ||
      url.hostname === "www.otutorhub.com" ||
      url.hostname.endsWith(".lovable.app");
    return url.protocol === "https:" && isAllowedHost ? url.toString() : DEFAULT_RETURN_TO;
  } catch (_) {
    return DEFAULT_RETURN_TO;
  }
}

function encodeState(payload: Record<string, string>) {
  return btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
    state: encodeState({ user_id: userId, return_to: safeReturnTo(url.searchParams.get("return_to")) }),
    include_granted_scopes: "true",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    302,
  );
});
