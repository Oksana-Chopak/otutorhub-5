// google-calendar-import — наступні 4 тижні з Google Календаря → події для
// імпорту (29.09, «Перенести все, що є», частина 2).
//
// Читає ЛИШЕ (calendar.events, той самий OAuth, що вже стоїть для синхронізації
// з застосунку в Google). Повертає прості події: назва, початок, кінець,
// повторюваність. Учнів і уроки з них робить клієнт (той самий парсер і той
// самий екран підтвердження — числа не вигадуються), а не ця функція.
// Межі: 28 днів, до 500 подій, стеля 20 читань/год на людину в базі.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { versionProbe } from "../_shared/build.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const IMPORT_DAYS = 28;
export const MAX_EVENTS = 500;
const PER_USER_HOUR = 20;

interface TokenRow { user_id: string; access_token: string; refresh_token: string | null; expires_at: string | null }

async function refreshAccessToken(admin: any, row: TokenRow, clientId: string, clientSecret: string): Promise<string | null> {
  if (!row.refresh_token) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: row.refresh_token, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) return null;
  await admin.from("google_calendar_tokens").update({
    access_token: data.access_token,
    expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", row.user_id);
  return data.access_token;
}

async function getValidToken(admin: any, userId: string, clientId: string, clientSecret: string): Promise<string | null> {
  const { data } = await admin.from("google_calendar_tokens")
    .select("user_id, access_token, refresh_token, expires_at").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expiresAt - 60_000 > Date.now()) return data.access_token;
  return await refreshAccessToken(admin, data as TokenRow, clientId, clientSecret);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const probe = versionProbe(req, "google-calendar-import");
  if (probe) return probe;
  if (req.method !== "POST") return json(405, { error: "method" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return json(500, { error: "not_configured" });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: "unauthorized" });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if ((await rateLimit(admin, "gcal_import", user.id, PER_USER_HOUR, 3600)) === "limit") return json(429, { error: "rate_limited" });

  const token = await getValidToken(admin, user.id, clientId, clientSecret);
  if (!token) return json(409, { error: "not_connected" });

  const timeMin = new Date();
  const timeMax = new Date(Date.now() + IMPORT_DAYS * 24 * 3600 * 1000);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(MAX_EVENTS));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) return json(409, { error: "not_connected" });
  if (!res.ok) return json(502, { error: "google_error", status: res.status });
  const data = await res.json();

  // Лише те, що потрібно для впізнавання уроків: назва, час, чи повторюється.
  // Опис і учасники не повертаються — це чужі дані, вони імпорту не потрібні.
  const events = ((data.items ?? []) as any[])
    .filter((e) => e.status !== "cancelled" && e.start?.dateTime && e.end?.dateTime)
    .slice(0, MAX_EVENTS)
    .map((e) => ({
      id: String(e.id),
      summary: String(e.summary ?? "").slice(0, 120),
      start: String(e.start.dateTime),
      end: String(e.end.dateTime),
      recurring: Boolean(e.recurringEventId),
    }));

  return json(200, { events, days: IMPORT_DAYS });
});
