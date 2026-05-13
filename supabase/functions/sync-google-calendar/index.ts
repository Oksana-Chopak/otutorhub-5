// Syncs a single lesson to Google Calendar (create / update / delete) for both
// the tutor and (if connected) the student.
//
// POST /functions/v1/sync-google-calendar
// Body: { lesson_id: string, action?: "upsert" | "delete" }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface TokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

async function refreshAccessToken(
  admin: any,
  row: TokenRow,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  if (!row.refresh_token) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error("refresh failed", data);
    return null;
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await admin.from("google_calendar_tokens").update({
    access_token: data.access_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq("user_id", row.user_id);
  return data.access_token;
}

async function getValidToken(
  admin: any,
  userId: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const { data } = await admin
    .from("google_calendar_tokens")
    .select("user_id, access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expiresAt - 60_000 > Date.now()) return data.access_token;
  return await refreshAccessToken(admin, data as TokenRow, clientId, clientSecret);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const lessonId: string | undefined = body.lesson_id;
  const action: "upsert" | "delete" = body.action === "delete" ? "delete" : "upsert";

  if (!lessonId) {
    return new Response(JSON.stringify({ error: "lesson_id is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: lesson, error: lessonErr } = await admin
    .from("lessons")
    .select("id, tutor_id, student_id, subject, starts_at, duration_minutes, location, notes, status, google_event_id")
    .eq("id", lessonId)
    .maybeSingle();

  if (lessonErr || !lesson) {
    return new Response(JSON.stringify({ error: "lesson not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const start = new Date(lesson.starts_at);
  const end = new Date(start.getTime() + (lesson.duration_minutes ?? 60) * 60_000);

  const summary = `Урок: ${lesson.subject ?? ""}`.trim();
  const description = lesson.notes ?? "";
  const eventBody = {
    summary,
    description,
    location: lesson.location ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  const results: Record<string, any> = {};
  const participants = [lesson.tutor_id, lesson.student_id].filter(Boolean) as string[];

  for (const userId of participants) {
    const token = await getValidToken(admin, userId, clientId, clientSecret);
    if (!token) { results[userId] = { skipped: "no_token" }; continue; }

    try {
      if (action === "delete" && lesson.google_event_id) {
        const r = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${lesson.google_event_id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        );
        results[userId] = { delete_status: r.status };
      } else if (lesson.google_event_id) {
        const r = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${lesson.google_event_id}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(eventBody),
          },
        );
        results[userId] = { patch_status: r.status };
      } else {
        const r = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(eventBody),
          },
        );
        const data = await r.json();
        results[userId] = { create_status: r.status, event_id: data.id };
        if (r.ok && data.id && !lesson.google_event_id) {
          await admin.from("lessons").update({ google_event_id: data.id }).eq("id", lesson.id);
          (lesson as any).google_event_id = data.id;
        }
      }
    } catch (e) {
      console.error("sync error", userId, e);
      results[userId] = { error: String(e) };
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
