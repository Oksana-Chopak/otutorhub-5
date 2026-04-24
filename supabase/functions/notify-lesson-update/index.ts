// Sends a Telegram notification to the student when the tutor (or manager)
// updates the lesson homework and/or summary.
import { corsHeaders } from "@supabase/supabase-js/cors";
import { createClient } from "@supabase/supabase-js";

interface RequestBody {
  lessonId: string;
  changed: Array<"homework" | "summary">;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userData.user.id;

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body?.lessonId || typeof body.lessonId !== "string") {
      return new Response(JSON.stringify({ error: "lessonId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const changed = Array.isArray(body.changed)
      ? body.changed.filter((f) => f === "homework" || f === "summary")
      : [];
    if (changed.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no changes" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is tutor of the lesson OR manager — fetch via user-scoped client (RLS)
    const { data: lesson, error: lessonErr } = await userClient
      .from("lessons")
      .select("id, tutor_id, student_id, subject, starts_at")
      .eq("id", body.lessonId)
      .maybeSingle();

    if (lessonErr || !lesson) {
      return new Response(JSON.stringify({ error: "Lesson not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Manager check via service-key (only used for role lookup)
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: managerRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "manager")
      .maybeSingle();
    const isManager = !!managerRow;

    if (!isManager && lesson.tutor_id !== callerId) {
      return new Response(JSON.stringify({ error: "Only the lesson tutor or manager can notify" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!TELEGRAM_BOT_TOKEN) {
      // Soft success — nothing to send, but the update itself already happened.
      return new Response(JSON.stringify({ ok: true, skipped: "no telegram bot token" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up student's telegram link with service key (the caller usually can't read it)
    const { data: link } = await adminClient
      .from("user_telegram_links")
      .select("chat_id")
      .eq("user_id", lesson.student_id)
      .not("chat_id", "is", null)
      .maybeSingle();

    if (!link?.chat_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "student has no telegram link" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const labels: Record<string, string> = {
      homework: "📝 домашнє завдання",
      summary: "📚 конспект уроку",
    };
    const updatedList = changed.map((f) => labels[f]).join(" та ");

    const lessonDate = new Date(lesson.starts_at).toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const text =
      `🔔 Оновлено ${updatedList}\n\n` +
      `<b>${escapeHtml(lesson.subject)}</b> — ${escapeHtml(lessonDate)}\n\n` +
      `<a href="https://otutorhub.lovable.app/schedule">Відкрити урок</a>`;

    const tgResp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: link.chat_id,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!tgResp.ok) {
      const tgData = await tgResp.json().catch(() => ({}));
      console.error("Telegram send failed", tgResp.status, tgData);
      return new Response(JSON.stringify({ error: "telegram_failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-lesson-update unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
