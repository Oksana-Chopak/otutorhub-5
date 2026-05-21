// Sends an immediate payment reminder for a single lesson via Telegram + email.
// Called from the dashboard "Bell" button by tutor or manager.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid auth token" }, 401);

  let lessonId: string;
  try {
    const body = await req.json();
    lessonId = body.lessonId || body.lesson_id;
    if (!lessonId) return json({ error: "lessonId required" }, 400);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  const { data: lessonRow } = await admin
    .from("lessons")
    .select(
      "id, tutor_id, student_id, subject, starts_at, lesson_details!inner(student_price, student_payment_status)",
    )
    .eq("id", lessonId)
    .maybeSingle();
  if (!lessonRow) return json({ error: "Lesson not found" }, 404);
  const lesson: any = {
    ...lessonRow,
    student_price: (lessonRow as any).lesson_details?.student_price,
    student_payment_status: (lessonRow as any).lesson_details?.student_payment_status,
  };
  if (lesson.student_payment_status === "paid") {
    return json({ error: "already_paid" }, 409);
  }

  // Authorization: manager OR the lesson's tutor
  const { data: isManagerData } = await admin.rpc("check_user_role", {
    _user_id: user.id,
    _role: "manager",
  });
  const isManager = isManagerData === true;
  if (!isManager && lesson.tutor_id !== user.id) {
    return json({ error: "forbidden" }, 403);
  }

  // Fetch profiles + contact + tg link
  const [{ data: studentProfile }, { data: tutorProfile }, { data: contact }, { data: tgLink }] =
    await Promise.all([
      admin.from("profiles").select("first_name, last_name").eq("id", lesson.student_id).maybeSingle(),
      admin.from("profiles").select("first_name, last_name").eq("id", lesson.tutor_id).maybeSingle(),
      admin.from("profile_contacts").select("email").eq("user_id", lesson.student_id).maybeSingle(),
      admin.from("user_telegram_links").select("chat_id").eq("user_id", lesson.student_id).maybeSingle(),
    ]);

  const studentName =
    [studentProfile?.first_name, studentProfile?.last_name].filter(Boolean).join(" ").trim() || "учень";
  const tutorName =
    [tutorProfile?.first_name, tutorProfile?.last_name].filter(Boolean).join(" ").trim() || "репетитор";
  const lessonDate = new Date(lesson.starts_at).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const amount = Number(lesson.student_price ?? 0);

  const channels: string[] = [];
  let tgOk = false;
  let emailOk = false;
  let emailReason: string | undefined;

  // Telegram
  const chatId = tgLink?.chat_id ? Number(tgLink.chat_id) : null;
  if (chatId && TELEGRAM_BOT_TOKEN) {
    const text = `💳 <b>Нагадування про оплату</b>\n\n${escapeHtml(tutorName)} нагадує про оплату уроку <b>${escapeHtml(lesson.subject)}</b> (${lessonDate}).${
      amount > 0 ? `\n\nСума: <b>${amount} ₴</b>` : ""
    }\n\nДякуємо! 🙏`;
    const r = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    tgOk = r.ok;
    if (tgOk) channels.push("telegram");
  }

  // Email
  const email = contact?.email?.trim();
  if (email) {
    const r = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
        apikey: supabaseServiceKey,
      },
      body: JSON.stringify({
        templateName: "payment-reminder",
        recipientEmail: email,
        idempotencyKey: `payment-reminder:${lesson.id}:${new Date().toISOString().slice(0, 13)}`,
        templateData: { studentName, tutorName, subject: lesson.subject, lessonDate, amount },
      }),
    });
    if (r.ok) {
      emailOk = true;
      channels.push("email");
    } else {
      const body = await r.json().catch(() => ({}));
      emailReason = JSON.stringify(body);
    }
  }

  // Log to lesson_payment_reminders for each successful channel
  for (const ch of channels) {
    await admin.from("lesson_payment_reminders").insert({
      lesson_id: lesson.id,
      tutor_id: lesson.tutor_id,
      student_id: lesson.student_id,
      reminder_kind: "manual",
      channel: ch,
    });
  }

  if (channels.length === 0) {
    return json(
      { success: false, reason: "no_channels", hasEmail: !!email, hasTelegram: !!chatId, emailReason },
      200,
    );
  }
  return json({ success: true, channels, telegram: tgOk, email: emailOk });
});
