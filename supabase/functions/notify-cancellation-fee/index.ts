// Notifies tutor in Telegram when a late-cancellation fee was auto-charged.
// Called by the apply_late_cancellation_fee DB trigger via pg_net with the
// cron shared secret as Authorization.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js";

interface Body {
  lesson_id: string;
  tutor_id: string;
  student_id: string;
  fee: number;
  starts_at: string;
  subject: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const admin = createClient(supabaseUrl, serviceKey);

    // Validate against cron shared secret
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: secret } = await admin.rpc("get_cron_shared_secret");
    if (!secret || token !== secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.lesson_id || !body?.tutor_id) {
      return new Response(JSON.stringify({ error: "bad_request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!TELEGRAM_BOT_TOKEN) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: link } = await admin
      .from("user_telegram_links")
      .select("chat_id")
      .eq("user_id", body.tutor_id)
      .not("chat_id", "is", null)
      .maybeSingle();

    if (!link?.chat_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_link" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: student } = await admin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", body.student_id)
      .maybeSingle();

    const studentName = [student?.first_name, student?.last_name]
      .filter(Boolean)
      .join(" ") || "Учень";

    const when = new Date(body.starts_at).toLocaleString("uk-UA", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Kyiv",
    });

    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const text =
      `⚠️ <b>${escapeHtml(studentName)}</b> скасував урок ` +
      `(${escapeHtml(body.subject)}, ${escapeHtml(when)}).\n\n` +
      `Згідно правила пізнього скасування нараховано ` +
      `<b>${body.fee} ₴</b> до сплати.\n\n` +
      `<a href="https://otutorhub.lovable.app/finances">Перейти у Фінанси</a>`;

    const tg = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: link.chat_id,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!tg.ok) {
      const data = await tg.json().catch(() => ({}));
      console.error("telegram failed", tg.status, data);
      return new Response(JSON.stringify({ error: "telegram_failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-cancellation-fee error", err);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
