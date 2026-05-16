// Handles Google OAuth callback, stores tokens, redirects user back to app.
// GET /functions/v1/google-calendar-callback?code=...&state=<signed>
// State MUST be HMAC-signed by google-calendar-auth. Unsigned / invalid state
// is rejected to prevent token-slot hijacking.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const REDIRECT_URI =
  "https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/google-calendar-callback";
const APP_RETURN_URL = "https://otutorhub.com/profile?calendar=connected";
const APP_ERROR_URL = "https://otutorhub.com/profile?calendar=error";
const STATE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

function withCalendarParam(returnTo: string, calendar: "connected" | "error", reason?: string) {
  try {
    const url = new URL(returnTo);
    const isAllowedHost =
      url.hostname === "otutorhub.com" ||
      url.hostname === "www.otutorhub.com" ||
      url.hostname.endsWith(".lovable.app");
    if (url.protocol !== "https:" || !isAllowedHost) throw new Error("unsafe_return_to");
    url.searchParams.set("calendar", calendar);
    if (reason) url.searchParams.set("reason", reason);
    return url.toString();
  } catch (_) {
    return calendar === "connected" ? APP_RETURN_URL : `${APP_ERROR_URL}${reason ? `&reason=${reason}` : ""}`;
  }
}

function b64urlDecodeToString(b64: string): string {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function b64urlEncode(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifyState(value: string | null, secret: string): Promise<
  { userId: string; returnTo: string } | null
> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  let expected: string;
  try {
    expected = await hmacSign(secret, body);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const parsed = JSON.parse(b64urlDecodeToString(body));
    const userId = typeof parsed.user_id === "string" ? parsed.user_id : null;
    const returnTo =
      typeof parsed.return_to === "string" ? parsed.return_to : "https://otutorhub.com/profile";
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (!userId) return null;
    if (!ts || Date.now() - ts > STATE_MAX_AGE_MS) return null;
    return { userId, returnTo };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  const stateSecret =
    Deno.env.get("OAUTH_STATE_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey || !stateSecret) {
    return Response.redirect(withCalendarParam(APP_RETURN_URL, "error", "server_misconfigured"), 302);
  }

  const verified = await verifyState(url.searchParams.get("state"), stateSecret);
  if (!verified) {
    return Response.redirect(withCalendarParam(APP_RETURN_URL, "error", "invalid_state"), 302);
  }
  const { userId, returnTo } = verified;

  if (errorParam || !code) {
    return Response.redirect(withCalendarParam(returnTo, "error", errorParam ?? "missing_params"), 302);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.access_token) {
      console.error("Token exchange failed", tokens);
      return Response.redirect(withCalendarParam(returnTo, "error", "token_exchange"), 302);
    }

    let googleEmail: string | null = null;
    try {
      const userInfo = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfo.ok) {
        const info = await userInfo.json();
        googleEmail = info.email ?? null;
      }
    } catch (_) { /* ignore */ }

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

    const admin = createClient(supabaseUrl, serviceKey);
    const { error } = await admin.from("google_calendar_tokens").upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: expiresAt,
      google_email: googleEmail,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (error) {
      console.error("Failed to save tokens", error);
      return Response.redirect(withCalendarParam(returnTo, "error", "db_save"), 302);
    }

    return Response.redirect(withCalendarParam(returnTo, "connected"), 302);
  } catch (e) {
    console.error("Callback error", e);
    return Response.redirect(withCalendarParam(returnTo, "error", "exception"), 302);
  }
});
