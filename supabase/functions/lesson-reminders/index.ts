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

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  // Require shared-secret auth (service role key) — only trusted cron/internal callers.
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret");
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: expected } = await supabase.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
  const now = Date.now();

  // Window: lessons that started up to 48h ago (for "mark status" nudge)
  // and lessons starting up to 90 min ahead.
  const fromIso = new Date(now - 48 * 60 * MIN_MS).toISOString();
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

  // ─── Auto-complete lessons for tutors who opted in ───
  // Mark lessons "completed" 60 min after their end time.
  const tutorIds = Array.from(new Set(lessons.map((l: any) => l.tutor_id)));
  const { data: settingsRows } = await supabase
    .from("tutor_workspace_settings")
    .select("tutor_id, auto_complete_lessons")
    .in("tutor_id", tutorIds);
  const autoSet = new Set(
    (settingsRows ?? [])
      .filter((s: any) => s.auto_complete_lessons === true)
      .map((s: any) => s.tutor_id as string),
  );
  let autoCompleted = 0;
  for (const lesson of lessons) {
    if (lesson.status !== "scheduled") continue;
    if (!autoSet.has(lesson.tutor_id)) continue;
    const endMs = new Date(lesson.starts_at).getTime() + (lesson.duration_minutes ?? 60) * MIN_MS;
    if (now - endMs < 60 * MIN_MS) continue;
    const { error: updErr } = await supabase
      .from("lessons")
      .update({ status: "completed" })
      .eq("id", lesson.id)
      .eq("status", "scheduled");
    if (!updErr) {
      lesson.status = "completed";
      autoCompleted++;
    }
  }

  let sent = 0;
  let skipped = 0;

  // Build lesson -> has-feedback map (so we don't nag students who already rated)
  const completedIds = lessons.filter((l: any) => l.status === "completed").map((l: any) => l.id);
  const feedbackSet = new Set<string>();
  if (completedIds.length > 0) {
    const { data: fb } = await supabase
      .from("lesson_feedback")
      .select("lesson_id")
      .in("lesson_id", completedIds);
    for (const r of fb ?? []) feedbackSet.add(r.lesson_id);
  }

  for (const lesson of lessons) {
    const startMs = new Date(lesson.starts_at).getTime();

    // ─── Post-lesson feedback nudge to student ───
    // Trigger ~1h after lesson end (start + duration + 60min), only if completed and no feedback yet.
    if (lesson.status === "completed" && !feedbackSet.has(lesson.id)) {
      const endMs = startMs + (lesson.duration_minutes ?? 60) * MIN_MS;
      const fbTrigger = endMs + 60 * MIN_MS;
      const fbWindow = 90 * MIN_MS;
      if (now >= fbTrigger && now - fbTrigger <= fbWindow) {
        const studentChat = chatByUser.get(lesson.student_id);
        const fbKey = `${lesson.id}:${lesson.student_id}:feedback_nudge`;
        if (studentChat && !sentSet.has(fbKey)) {
          const tutorName = nameById.get(lesson.tutor_id) ?? "репетитором";
          const text =
            `⭐ Як пройшов урок з <b>${tutorName}</b> (${lesson.subject})?\n\n` +
            `Відкрийте урок у застосунку і поставте оцінку — це допоможе репетитору і іншим учням.`;
          if (await sendTg(TELEGRAM_BOT_TOKEN, studentChat, text)) {
            await supabase.from("lesson_reminders").insert({
              lesson_id: lesson.id,
              tutor_id: lesson.tutor_id,
              student_id: lesson.student_id,
              recipient_id: lesson.student_id,
              recipient_role: "student",
              reminder_kind: "feedback_nudge",
              channel: "telegram",
            });
            sent++;
          } else skipped++;
        }
      }
    }

    // ─── Nudge tutor to mark unfinished lesson as completed/cancelled ───
    // Trigger ~30 min after the lesson should have ended, then again at 24h, while it's still scheduled.
    if (lesson.status === "scheduled") {
      const endMs = startMs + (lesson.duration_minutes ?? 60) * MIN_MS;
      const nudges = [
        { kind: "mark_status_30m", delayMs: 30 * MIN_MS, windowMs: 90 * MIN_MS },
        { kind: "mark_status_24h", delayMs: 24 * 60 * MIN_MS, windowMs: 6 * 60 * MIN_MS },
      ];
      for (const n of nudges) {
        const trigger = endMs + n.delayMs;
        if (now < trigger) continue;
        if (now - trigger > n.windowMs) continue;
        const tutorChat = chatByUser.get(lesson.tutor_id);
        const key = `${lesson.id}:${lesson.tutor_id}:${n.kind}`;
        if (!tutorChat || sentSet.has(key)) continue;
        const studentName = nameById.get(lesson.student_id) ?? "учнем";
        const dateStr = new Date(lesson.starts_at).toLocaleString("uk-UA", {
          timeZone: "Europe/Kyiv",
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        });
        const text =
          `📝 Урок з <b>${studentName}</b> (${lesson.subject}) ${dateStr} вже мав відбутися.\n\n` +
          `Будь ласка, відмітьте у застосунку: <b>Проведено</b> ✅ або <b>Скасовано</b> ❌.\n` +
          `Без статусу оплата за урок не нараховується.`;
        if (await sendTg(TELEGRAM_BOT_TOKEN, tutorChat, text)) {
          await supabase.from("lesson_reminders").insert({
            lesson_id: lesson.id,
            tutor_id: lesson.tutor_id,
            student_id: lesson.student_id,
            recipient_id: lesson.tutor_id,
            recipient_role: "tutor",
            reminder_kind: n.kind,
            channel: "telegram",
          });
          sent++;
        } else skipped++;
      }
    }

    // ─── Pre-lesson reminders ───
    if (lesson.status !== "scheduled") continue;

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
        ? `\n\n🔗 <a href="${escapeHtmlAttr(String(lesson.meeting_url))}">Посилання на урок</a>`
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
    JSON.stringify({ ok: true, scanned: lessons.length, sent, skipped, autoCompleted }),
    { headers: { "Content-Type": "application/json" } },
  );
});
