// Handles Google OAuth callback, stores tokens, redirects user back to app.
// GET /functions/v1/google-calendar-callback?code=...&state=user_id

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const REDIRECT_URI =
  "https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/google-calendar-callback";
const APP_RETURN_URL = "https://otutorhub.com/profile?calendar=connected";
const APP_ERROR_URL = "https://otutorhub.com/profile?calendar=error";

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

function parseState(value: string | null) {
  if (!value) return { userId: null, returnTo: "https://otutorhub.com/profile" };
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    return {
      userId: typeof parsed.user_id === "string" ? parsed.user_id : null,
      returnTo: typeof parsed.return_to === "string" ? parsed.return_to : "https://otutorhub.com/profile",
    };
  } catch (_) {
    return { userId: value, returnTo: "https://otutorhub.com/profile" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const { userId, returnTo } = parseState(url.searchParams.get("state"));
  const errorParam = url.searchParams.get("error");

  if (errorParam || !code || !userId) {
    return Response.redirect(withCalendarParam(returnTo, "error", errorParam ?? "missing_params"), 302);
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    return Response.redirect(withCalendarParam(returnTo, "error", "server_misconfigured"), 302);
  }

  try {
    // Exchange code for tokens
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

    // Get user email (best-effort)
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
