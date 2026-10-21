import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withErrorLog } from "../_shared/errorLog.ts";
import { lessonIdFromTitle, legacyLessonIdFromTitle } from "../_shared/firefliesTitle.ts";

// Public webhook: Fireflies POSTs here when a transcript is ready.
// Configure the URL in Fireflies dashboard:
//   https://<PROJECT_REF>.supabase.co/functions/v1/fireflies-webhook
// No JWT verification (verify_jwt = false in config.toml).

// Constant-time string compare to avoid leaking the secret via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(withErrorLog("fireflies-webhook", async (req) => {
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
  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
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

    // Який урок? (red team 20.10, H1)
    //   1) збережений fireflies_meeting_id (повторний вебхук тієї ж зустрічі);
    //   2) назва зустрічі `oTutorHub [<lessonId>.<HMAC-тег>]` — лише зі справжнім
    //      тегом (_shared/firefliesTitle.ts); підробити його без секрету не можна;
    //   3) старий формат `[<uuid>]` без тегу або clientReferenceId — ЛИШЕ для уроку,
    //      де бот справді був замовлений нами (lesson_details.fireflies_status =
    //      'requested'): записи, запущені до цього деплою, мають долетіти, а чужий
    //      uuid у назві зустрічі більше не є «адресою».
    // Було: будь-який `[uuid]` у назві → транскрипт лягав у той урок, тож репетитор
    // міг записати СВОЮ зустріч з назвою `x [<чужий урок>]` і підкласти чужому
    // репетитору «готовий конспект» зі своїм текстом.
    let lessonId: string | null = null;
    let resolvedBy: "meeting_id" | "bound_title" | "legacy_requested" | null = null;

    // 1) Look up by stored fireflies_meeting_id
    const { data: byMeeting } = await admin
      .from("lesson_details")
      .select("lesson_id")
      .eq("fireflies_meeting_id", meetingId)
      .maybeSingle();

    if (byMeeting?.lesson_id) {
      lessonId = byMeeting.lesson_id;
      resolvedBy = "meeting_id";
    } else {
      // 2) HMAC-bound title
      const bound = await lessonIdFromTitle(t.title, expectedSecret);
      if (bound) {
        lessonId = bound;
        resolvedBy = "bound_title";
      }
    }

    // 3) Legacy bare id / clientReferenceId — only if WE requested a bot for it.
    if (!lessonId) {
      const candidates = [
        legacyLessonIdFromTitle(t.title),
        typeof payload.clientReferenceId === "string" && /^[0-9a-f-]{36}$/i.test(payload.clientReferenceId)
          ? payload.clientReferenceId.toLowerCase()
          : null,
      ].filter((c): c is string => !!c);
      for (const cand of candidates) {
        const { data: requested } = await admin
          .from("lesson_details")
          .select("lesson_id, fireflies_status")
          .eq("lesson_id", cand)
          .eq("fireflies_status", "requested")
          .maybeSingle();
        if (requested?.lesson_id) {
          lessonId = requested.lesson_id;
          resolvedBy = "legacy_requested";
          break;
        }
      }
    }

    if (!lessonId) {
      console.log("Webhook: could not resolve lessonId for meeting", meetingId, "title:", typeof t.title === "string" ? t.title.slice(0, 80) : null);
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

    // ─── «AI під наглядом» (27.09): конспект із запису — ЧЕРНЕТКА для репетитора ───
    // Раніше (за перемикачем ai_notes_auto_send) текст Fireflies без жодного
    // перегляду лягав у `summary`, який бачить учень, і учню летіло сповіщення
    // «репетитор надіслав конспект». Тепер учню автоматично не йде нічого:
    // репетитор отримує сповіщення «конспект із запису готовий», відкриває урок
    // і одним дотиком («Використати як конспект» → «Зберегти й надіслати»)
    // публікує те, що перечитав. Best-effort; вебхук не падає.
    if (summaryText) {
      try {
        const { data: lessonRow } = await admin
          .from("lessons")
          .select("tutor_id, student_id")
          .eq("id", lessonId)
          .maybeSingle();
        const tutorId = lessonRow?.tutor_id as string | undefined;
        if (tutorId) {
          const notifType = `fireflies_summary_ready_${lessonId}`;
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: dupe } = await admin
            .from("notifications")
            .select("id")
            .eq("user_id", tutorId)
            .eq("type", notifType)
            .gte("created_at", since)
            .limit(1)
            .maybeSingle();
          if (!dupe) {
            await admin.from("notifications").insert({
              user_id: tutorId,
              type: notifType,
              title: "🎙 Конспект із запису готовий",
              body: "Перегляньте його в уроці та надішліть учню одним дотиком — автоматично учню нічого не йде.",
              link: `/schedule?lesson=${lessonId}`,
            });
          }
        }
      } catch (e) {
        console.error("fireflies-webhook tutor notification failed (non-blocking):", e);
      }
    }

    console.log("Fireflies webhook stored transcript for lesson", lessonId, "event:", eventType, "resolved by:", resolvedBy);
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
}));
