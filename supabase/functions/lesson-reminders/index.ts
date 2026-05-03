// Sends Telegram reminders to tutor and student before a lesson starts.
// Two reminders: 60 minutes before and 15 minutes before.
// Idempotent via lesson_reminders log. Run on a cron every 5 minutes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MIN_MS = 60 * 1000;

interface ReminderRule {
  kind: string;
  minutesBefore: number;
  windowMs: number; // tolerance window after target
}

const RULES: ReminderRule[] = [
  { kind: "before_60m", minutesBefore: 60, windowMs: 30 * MIN_MS },
  { kind: "before_15m", minutesBefore: 15, windowMs: 20 * MIN_MS },
];

async function sendTg(botToken: string, chatId: number, text: string): Promise<boolean> {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  return resp.ok;
}

Deno.serve(async () => {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const now = Date.now();

  // Window: lessons that started up to 4h ago (for post-lesson feedback nudge)
  // and lessons starting up to 90 min ahead.
  const fromIso = new Date(now - 4 * 60 * MIN_MS).toISOString();
  const toIso = new Date(now + 90 * MIN_MS).toISOString();

  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("id, tutor_id, student_id, starts_at, status, subject, meeting_url, duration_minutes")
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .in("status", ["scheduled", "completed"]);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!lessons || lessons.length === 0) {
    return new Response(JSON.stringify({ ok: true, scanned: 0, sent: 0 }));
  }

  // Fetch telegram links for all relevant users
  const userIds = Array.from(new Set(lessons.flatMap((l: any) => [l.tutor_id, l.student_id])));
  const { data: tgLinks } = await supabase
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .in("user_id", userIds)
    .not("chat_id", "is", null);
  const chatByUser = new Map<string, number>();
  for (const link of tgLinks ?? []) {
    if (link.chat_id) chatByUser.set(link.user_id, Number(link.chat_id));
  }

  // Profile names
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", userIds);
  const nameById = new Map<string, string>();
  for (const p of profiles ?? []) {
    nameById.set(
      p.id,
      `${(p.first_name ?? "").trim()} ${(p.last_name ?? "").trim()}`.trim() || "—",
    );
  }

  // Existing reminders for idempotency
  const lessonIds = lessons.map((l: any) => l.id);
  const { data: existing } = await supabase
    .from("lesson_reminders")
    .select("lesson_id, recipient_id, reminder_kind")
    .in("lesson_id", lessonIds);
  const sentSet = new Set(
    (existing ?? []).map((r: any) => `${r.lesson_id}:${r.recipient_id}:${r.reminder_kind}`),
  );

  let sent = 0;
  let skipped = 0;

  for (const lesson of lessons) {
    const startMs = new Date(lesson.starts_at).getTime();
    for (const rule of RULES) {
      const triggerMs = startMs - rule.minutesBefore * MIN_MS;
      // Fire only when trigger time has passed but we're still within the window
      if (now < triggerMs) continue;
      if (now - triggerMs > rule.windowMs) continue;

      const dateStr = new Date(lesson.starts_at).toLocaleString("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
      const studentName = nameById.get(lesson.student_id) ?? "учень";
      const tutorName = nameById.get(lesson.tutor_id) ?? "репетитор";
      const link = lesson.meeting_url
        ? `\n\n🔗 <a href="${lesson.meeting_url}">Посилання на урок</a>`
        : "\n\n⚠️ Посилання на урок ще не додано.";

      // Send to tutor
      const tutorChat = chatByUser.get(lesson.tutor_id);
      const tutorKey = `${lesson.id}:${lesson.tutor_id}:${rule.kind}`;
      if (tutorChat && !sentSet.has(tutorKey)) {
        const text =
          `⏰ Урок з <b>${studentName}</b> через ${rule.minutesBefore} хв\n` +
          `📚 ${lesson.subject}\n📅 ${dateStr}${link}`;
        if (await sendTg(TELEGRAM_BOT_TOKEN, tutorChat, text)) {
          await supabase.from("lesson_reminders").insert({
            lesson_id: lesson.id,
            tutor_id: lesson.tutor_id,
            student_id: lesson.student_id,
            recipient_id: lesson.tutor_id,
            recipient_role: "tutor",
            reminder_kind: rule.kind,
            channel: "telegram",
          });
          sent++;
        } else skipped++;
      }

      // Send to student
      const studentChat = chatByUser.get(lesson.student_id);
      const studentKey = `${lesson.id}:${lesson.student_id}:${rule.kind}`;
      if (studentChat && !sentSet.has(studentKey)) {
        const text =
          `⏰ Урок з <b>${tutorName}</b> через ${rule.minutesBefore} хв\n` +
          `📚 ${lesson.subject}\n📅 ${dateStr}${link}`;
        if (await sendTg(TELEGRAM_BOT_TOKEN, studentChat, text)) {
          await supabase.from("lesson_reminders").insert({
            lesson_id: lesson.id,
            tutor_id: lesson.tutor_id,
            student_id: lesson.student_id,
            recipient_id: lesson.student_id,
            recipient_role: "student",
            reminder_kind: rule.kind,
            channel: "telegram",
          });
          sent++;
        } else skipped++;
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: lessons.length, sent, skipped }),
    { headers: { "Content-Type": "application/json" } },
  );
});
