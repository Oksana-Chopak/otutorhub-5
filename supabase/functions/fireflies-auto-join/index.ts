// Cron: auto-start Fireflies recording for lessons about to begin whose tutor
// enabled "Авто-конспект" (ai_notes_auto). Server-side equivalent of the
// client maybeAutoStartFireflies, so recording starts even when the tutor joins
// via an external calendar link (not the in-app Join button). Run every ~5 min.
// Auth: cron shared secret (get_cron_shared_secret), like the other crons.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tutorAiAllowed } from "../_shared/aiGate.ts";

const MIN_MS = 60 * 1000;

async function dispatchBot(apiKey: string, meetingUrl: string, title: string): Promise<boolean> {
  const mutation = `
    mutation AddBot($meeting_link: String!, $title: String!) {
      addToLiveMeeting(meeting_link: $meeting_link, title: $title) { success message }
    }
  `;
  try {
    const res = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables: { meeting_link: meetingUrl, title } }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.errors) {
      console.error("auto-join Fireflies error:", res.status, JSON.stringify(json?.errors ?? json));
      return false;
    }
    return true;
  } catch (e) {
    console.error("auto-join Fireflies fetch failed:", e);
    return false;
  }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("FIREFLIES_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey);

  // Cron shared-secret auth (same scheme as lesson-reminders / digests).
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret");
  const { data: expected } = await admin.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "FIREFLIES_API_KEY not configured" }), { status: 500 });
  }

  const now = Date.now();
  const fromIso = new Date(now - 5 * MIN_MS).toISOString();
  const toIso = new Date(now + 10 * MIN_MS).toISOString();

  // Lessons about to start, with their details (to skip already-requested ones).
  const { data: lessons, error } = await admin
    .from("lessons")
    .select("id, tutor_id, student_id, subject, meeting_url, starts_at, status, lesson_details(fireflies_status)")
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .eq("status", "scheduled");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!lessons || lessons.length === 0) {
    return new Response(JSON.stringify({ ok: true, scanned: 0, started: 0 }));
  }

  // Tutors who opted into auto-record.
  const tutorIds = Array.from(new Set(lessons.map((l: any) => l.tutor_id)));
  const { data: settings } = await admin
    .from("tutor_workspace_settings")
    .select("tutor_id, ai_notes_auto")
    .in("tutor_id", tutorIds);
  const autoTutors = new Set(
    (settings ?? []).filter((s: any) => s.ai_notes_auto === true).map((s: any) => s.tutor_id as string),
  );

  let started = 0;
  let skipped = 0;
  const allowedCache = new Map<string, boolean>();

  for (const lesson of lessons as any[]) {
    if (!autoTutors.has(lesson.tutor_id)) { skipped++; continue; }

    const det = Array.isArray(lesson.lesson_details) ? lesson.lesson_details[0] : lesson.lesson_details;
    if (det?.fireflies_status) { skipped++; continue; } // already requested/ready — don't double-start

    // Pro gate — never record for a non-Pro independent tutor.
    let allowed = allowedCache.get(lesson.tutor_id);
    if (allowed === undefined) {
      allowed = await tutorAiAllowed(admin, lesson.tutor_id);
      allowedCache.set(lesson.tutor_id, allowed);
    }
    if (!allowed) { skipped++; continue; }

    // Resolve a meeting URL: per-lesson first, then the tutor↔student default.
    let meetingUrl: string | null =
      (lesson.meeting_url && String(lesson.meeting_url).trim()) || null;
    if (!meetingUrl) {
      const { data: def } = await admin
        .from("tutor_student_defaults")
        .select("default_meeting_url")
        .eq("tutor_id", lesson.tutor_id)
        .eq("student_id", lesson.student_id)
        .maybeSingle();
      meetingUrl = (def?.default_meeting_url && String(def.default_meeting_url).trim()) || null;
    }
    if (!meetingUrl || !/^https?:\/\//i.test(meetingUrl)) { skipped++; continue; }

    const title = `Tutoring: ${lesson.subject ?? "session"} [${lesson.id}]`;
    const ok = await dispatchBot(apiKey, meetingUrl, title);
    if (!ok) { skipped++; continue; }

    const { error: upErr } = await admin
      .from("lesson_details")
      .upsert(
        {
          lesson_id: lesson.id,
          fireflies_status: "requested",
          fireflies_requested_at: new Date().toISOString(),
        },
        { onConflict: "lesson_id" },
      );
    if (upErr) console.error("auto-join: status upsert failed for", lesson.id, upErr);
    started++;
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: lessons.length, started, skipped }),
    { headers: { "Content-Type": "application/json" } },
  );
});
