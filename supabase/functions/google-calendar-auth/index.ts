// Initiates Google Calendar OAuth flow.
// GET /functions/v1/google-calendar-auth?access_token={supabase_jwt}
// The caller MUST pass a valid Supabase access token; user_id is derived from
// the verified JWT — never from a client-supplied parameter.

import { createClient } from "npm:@supabase/supabase-js@2";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // Derive caller identity from a verified Supabase JWT. Accept either the
  // Authorization header (programmatic callers) or an `access_token` query
  // param (popup/redirect flows where headers can't be set).
  const authHeader = req.headers.get("Authorization") ?? "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const token = headerToken || url.searchParams.get("access_token") || "";

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: "server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, anonKey);
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (claimsErr || !userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
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
