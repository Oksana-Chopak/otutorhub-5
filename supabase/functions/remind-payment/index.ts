// Sends an immediate payment reminder for a single lesson via Telegram + email.
// Called from the dashboard "Bell" button by tutor or manager.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPaymentReminder } from "../_shared/paymentReminder.ts";

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

  // Усе нижче — спільне ядро (_shared/paymentReminder.ts): канали, мова
  // одержувача, лог і 24-годинна дедуплікація за lesson_payment_reminders.
  const result = await sendPaymentReminder({
    admin, supabaseUrl, serviceKey: supabaseServiceKey, botToken: TELEGRAM_BOT_TOKEN,
    tutorId: lesson.tutor_id, studentId: lesson.student_id, kind: "manual",
    lessons: [{ id: lesson.id, subject: lesson.subject, starts_at: lesson.starts_at, student_price: lesson.student_price }],
  });
  if (result.skipped > 0 && result.sent === 0) {
    return json({ success: false, reason: "already_reminded_today" }, 200);
  }
  const channels = result.channels;
  const email = channels.includes("email") ? "sent" : null;

  // inapp завжди є у channels, тож «жодного каналу» тепер неможливе; лишаємо
  // гілку на випадок майбутніх змін ядра.
  if (channels.length === 0) {
    return json({ success: false, reason: "no_channels", hasEmail: !!email }, 200);
  }
  return json({ success: true, channels, telegram: channels.includes("telegram"), email: channels.includes("email") });
});
