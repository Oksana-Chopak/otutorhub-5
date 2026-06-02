import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    let body: { lessonId?: string; meetingUrl?: string; title?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { lessonId, meetingUrl, title } = body;
    if (!lessonId || typeof lessonId !== "string") {
      return new Response(JSON.stringify({ error: "lessonId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!meetingUrl || !/^https?:\/\//i.test(meetingUrl)) {
      return new Response(JSON.stringify({ error: "Valid meetingUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is the tutor on this lesson
    const { data: lesson, error: lessonErr } = await userClient
      .from("lessons")
      .select("id, tutor_id, subject")
      .eq("id", lessonId)
      .maybeSingle();

    if (lessonErr || !lesson) {
      return new Response(JSON.stringify({ error: "Lesson not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lesson.tutor_id !== userId) {
      return new Response(JSON.stringify({ error: "Only the tutor can start recording" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("FIREFLIES_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "FIREFLIES_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meetingTitle = (title && title.trim()) || `Tutoring: ${lesson.subject ?? "session"} [${lessonId}]`;

    const mutation = `
      mutation AddBot($meeting_link: String!, $title: String!) {
        addToLiveMeeting(meeting_link: $meeting_link, title: $title) {
          success
          message
        }
      }
    `;

    const ffRes = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: { meeting_link: meetingUrl, title: meetingTitle },
      }),
    });

    const ffJson = await ffRes.json().catch(() => ({}));
    if (!ffRes.ok || ffJson?.errors) {
      console.error("Fireflies error:", ffRes.status, JSON.stringify(ffJson));
      const msg = ffJson?.errors?.[0]?.message ?? `Fireflies API ${ffRes.status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record requested state. Use service-role to bypass RLS reliably.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    await admin
      .from("lesson_details")
      .upsert(
        {
          lesson_id: lessonId,
          fireflies_status: "requested",
          fireflies_requested_at: new Date().toISOString(),
        },
        { onConflict: "lesson_id" }
      );

    return new Response(
      JSON.stringify({
        ok: true,
        fireflies: ffJson?.data?.addToLiveMeeting ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("fireflies-start-recording error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
