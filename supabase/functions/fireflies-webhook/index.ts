import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public webhook: Fireflies POSTs here when a transcript is ready.
// Configure the URL in Fireflies dashboard:
//   https://<PROJECT_REF>.supabase.co/functions/v1/fireflies-webhook
// No JWT verification (verify_jwt = false in config.toml).

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  // Verify webhook signature — only Fireflies should be able to invoke this.
  const expectedSecret = Deno.env.get("FIREFLIES_WEBHOOK_SECRET");
  if (!expectedSecret) {
    console.error("FIREFLIES_WEBHOOK_SECRET not configured");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }
  const providedSecret =
    req.headers.get("x-fireflies-webhook-secret") ||
    req.headers.get("x-webhook-secret");
  if (providedSecret !== expectedSecret) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }


  try {
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fireflies webhook payload shape (per docs):
    // { meetingId, eventType: "Transcription completed", clientReferenceId? }
    const meetingId: string | undefined =
      payload.meetingId || payload.transcriptId || payload.id;
    const eventType: string | undefined = payload.eventType;

    if (!meetingId) {
      console.log("Webhook missing meetingId:", JSON.stringify(payload));
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("FIREFLIES_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "FIREFLIES_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch full transcript from Fireflies
    const query = `
      query Transcript($id: String!) {
        transcript(id: $id) {
          id
          title
          transcript_url
          audio_url
          video_url
          summary {
            overview
            action_items
            short_summary
            keywords
          }
          sentences {
            index
            speaker_name
            text
            start_time
          }
        }
      }
    `;

    const ffRes = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { id: meetingId } }),
    });

    const ffJson = await ffRes.json().catch(() => ({}));
    if (!ffRes.ok || ffJson?.errors) {
      console.error("Fireflies transcript fetch error:", ffRes.status, JSON.stringify(ffJson));
      return new Response(JSON.stringify({ ok: true, fetched: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t = ffJson?.data?.transcript;
    if (!t) {
      return new Response(JSON.stringify({ ok: true, empty: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sentences = Array.isArray(t.sentences) ? t.sentences : [];
    const summaryText: string =
      t.summary?.overview || t.summary?.short_summary || "";
    const actionItemsRaw = t.summary?.action_items;
    let actionItems: string[] = [];
    if (Array.isArray(actionItemsRaw)) {
      actionItems = actionItemsRaw.map((s: unknown) => String(s));
    } else if (typeof actionItemsRaw === "string") {
      actionItems = actionItemsRaw
        .split(/\n+/)
        .map((s) => s.replace(/^[-*•\d.\s]+/, "").trim())
        .filter(Boolean);
    }
    const recordingUrl: string | null = t.video_url || t.transcript_url || null;
    const audioUrl: string | null = t.audio_url || null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Find lesson by stored meeting id (set when bot was added) OR by clientReferenceId
    // Title fallback: we wrote `[lessonId]` into the title — Fireflies may echo it back.
    // We match by fireflies_meeting_id first; if not yet set, we try to parse [lessonId] from title.
    let lessonId: string | null = null;

    // 1) Look up by stored fireflies_meeting_id
    const { data: byMeeting } = await admin
      .from("lesson_details")
      .select("lesson_id")
      .eq("fireflies_meeting_id", meetingId)
      .maybeSingle();

    if (byMeeting?.lesson_id) {
      lessonId = byMeeting.lesson_id;
    } else if (typeof t.title === "string") {
      // 2) Parse [lessonId] from title
      const m = t.title.match(/\[([0-9a-f-]{36})\]/i);
      if (m) lessonId = m[1];
    }

    // 3) Or fall back to clientReferenceId from webhook
    if (!lessonId && typeof payload.clientReferenceId === "string") {
      lessonId = payload.clientReferenceId;
    }

    if (!lessonId) {
      console.log("Webhook: could not resolve lessonId for meeting", meetingId);
      return new Response(JSON.stringify({ ok: true, resolved: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: upErr } = await admin
      .from("lesson_details")
      .upsert(
        {
          lesson_id: lessonId,
          fireflies_meeting_id: meetingId,
          fireflies_status: "ready",
          fireflies_transcript: sentences,
          fireflies_summary: summaryText || null,
          fireflies_action_items: actionItems,
          fireflies_recording_url: recordingUrl,
          fireflies_audio_url: audioUrl,
          fireflies_completed_at: new Date().toISOString(),
        },
        { onConflict: "lesson_id" }
      );

    if (upErr) {
      console.error("Webhook save error:", upErr);
      return new Response(JSON.stringify({ ok: false, error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Fireflies webhook stored transcript for lesson", lessonId, "event:", eventType);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fireflies-webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
