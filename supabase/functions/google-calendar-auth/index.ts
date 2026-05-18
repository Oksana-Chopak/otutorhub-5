// Initiates Google Calendar OAuth flow.
// GET /functions/v1/google-calendar-auth?access_token={supabase_jwt}
// The caller MUST pass a valid Supabase access token; user_id is derived from
// the verified JWT — never from a client-supplied parameter.
// State is HMAC-signed to prevent forgery / token-slot hijacking.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const REDIRECT_URI 
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

function b64urlEncode(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncodeString(str: string) {
  return b64urlEncode(new TextEncoder().encode(str));
}

async function hmacSign(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

async function buildSignedState(payload: Record<string, string>, secret: string) {
  const body = b64urlEncodeString(JSON.stringify({ ...payload, ts: Date.now() }));
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

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
  const stateSecret =
    Deno.env.get("OAUTH_STATE_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !stateSecret) {
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

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim();
  if (!clientId) {
    return new Response(JSON.stringify({ error: "GOOGLE_CLIENT_ID not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const state = await buildSignedState(
    { user_id: userId, return_to: safeReturnTo(url.searchParams.get("return_to")) },
    stateSecret,
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    include_granted_scopes: "true",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    302,
  );
});
