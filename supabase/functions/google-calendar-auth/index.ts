// Initiates Google Calendar OAuth flow using a one-time exchange code so the
// user's Supabase session JWT is never exposed in a URL query parameter.
//
// Flow:
//   1. Client calls this function via POST with `Authorization: Bearer <jwt>`.
//      Function verifies the JWT, mints a short-lived (60s), single-use code
//      tied to the user_id (+ optional return_to), stores it in
//      `google_oauth_exchange_codes`, and returns `{ redirect_url }` pointing
//      at this same function with `?code=<one-time-code>`.
//   2. Client opens that URL in a popup / top-level navigation.
//   3. GET ?code=... — function looks up the code, marks it used, derives
//      user_id server-side, then signs OAuth state and redirects to Google.
//
// The session JWT only ever travels in an Authorization header, never in a URL.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const REDIRECT_URI =
  "https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/google-calendar-callback";
const SCOPE = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const DEFAULT_RETURN_TO = "https://otutorhub.com/profile";
const CODE_TTL_SECONDS = 60;

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

function randomCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stateSecret = Deno.env.get("OAUTH_STATE_SECRET") || serviceKey;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim();

  if (!supabaseUrl || !anonKey || !serviceKey || !stateSecret) {
    return jsonResponse({ error: "server misconfigured" }, 500);
  }
  if (!clientId) {
    return jsonResponse({ error: "GOOGLE_CLIENT_ID not configured" }, 500);
  }

  const url = new URL(req.url);
  const admin = createClient(supabaseUrl, serviceKey);

  // -------- Step 1: mint a one-time exchange code (POST + Authorization). --------
  if (req.method === "POST") {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const jwt = authHeader.slice(7);

    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(jwt);
    const userId = claimsData?.claims?.sub;
    if (claimsErr || !userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: { return_to?: string } = {};
    try { body = await req.json(); } catch { /* empty body OK */ }

    const code = randomCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
    const returnTo = safeReturnTo(body.return_to ?? null);

    const { error: insertErr } = await admin
      .from("google_oauth_exchange_codes")
      .insert({ code, user_id: userId, return_to: returnTo, expires_at: expiresAt });
    if (insertErr) {
      console.error("[google-calendar-auth] failed to issue code", insertErr);
      return jsonResponse({ error: "failed to issue code" }, 500);
    }

    const redirectUrl = `https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/google-calendar-auth?code=${encodeURIComponent(code)}`;
    return jsonResponse({ redirect_url: redirectUrl });
  }

  // -------- Step 2: redeem code (GET ?code=...), then redirect to Google. --------
  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    if (!code) {
      return jsonResponse({ error: "missing code" }, 400);
    }

    // Atomic single-use redeem: only mark used if not already used and not expired.
    const nowIso = new Date().toISOString();
    const { data: redeemed, error: redeemErr } = await admin
      .from("google_oauth_exchange_codes")
      .update({ used_at: nowIso })
      .eq("code", code)
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("user_id, return_to")
      .maybeSingle();

    if (redeemErr || !redeemed) {
      return jsonResponse({ error: "invalid or expired code" }, 401);
    }

    const state = await buildSignedState(
      { user_id: redeemed.user_id, return_to: safeReturnTo(redeemed.return_to) },
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
  }

  return jsonResponse({ error: "method not allowed" }, 405);
});
