// Sends Telegram payment reminders to students based on each tutor's Pro rules.
// Should be invoked on a schedule (cron). Idempotent via lesson_payment_reminders log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface WorkspaceSettings {
  tutor_id: string;
  payment_reminder_enabled: boolean;
  payment_due_mode: "prepaid" | "before_lesson" | "after_lesson";
  payment_due_days: number;
  subscription_status: string;
  subscription_until: string | null;
  trial_until: string | null;
}

function isProActive(s: WorkspaceSettings): boolean {
  if (s.subscription_status === "active") return true;
  if (s.subscription_status === "trial" && s.trial_until) {
    return new Date(s.trial_until).getTime() > Date.now();
  }
  return false;
}

async function sendTg(
  botToken: string,
  chatId: number,
  text: string,
): Promise<boolean> {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return resp.ok;
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
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret");
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: expected } = await supabase.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
  const now = new Date();

  // Look at lessons in a [-7 days .. +30 days] window — covers all reasonable rules.
  const fromIso = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const toIso = new Date(now.getTime() + 30 * DAY_MS).toISOString();

  // 1. Pull candidate lessons (scheduled or completed, unpaid by student)
  const { data: lessonsRaw, error: lessonsErr } = await supabase
    .from("lessons")
    .select(
      "id, tutor_id, student_id, starts_at, status, subject, created_at, lesson_details!inner(student_payment_status, student_price)",
    )
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .in("status", ["scheduled", "completed"])
    .neq("lesson_details.student_payment_status", "paid");

  if (lessonsErr) {
    return new Response(JSON.stringify({ error: lessonsErr.message }), { status: 500 });
  }
  const lessons = (lessonsRaw ?? []).map((l: any) => ({
    ...l,
    student_payment_status: l.lesson_details?.student_payment_status,
    student_price: l.lesson_details?.student_price,
  }));
  if (lessons.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, scanned: 0 }));
  }

  // 2. Pull tutor settings for relevant tutors
  const tutorIds = Array.from(new Set(lessons.map((l: any) => l.tutor_id)));
  const { data: tutorSettings } = await supabase
    .from("tutor_workspace_settings")
    .select(
      "tutor_id, payment_reminder_enabled, payment_due_mode, payment_due_days, subscription_status, subscription_until, trial_until",
    )
    .in("tutor_id", tutorIds);

  const settingsByTutor = new Map<string, WorkspaceSettings>();
  for (const s of tutorSettings ?? []) {
    settingsByTutor.set(s.tutor_id, s as WorkspaceSettings);
  }

  // 3. Pull telegram chat ids for relevant students
  const studentIds = Array.from(new Set(lessons.map((l: any) => l.student_id)));
  const { data: tgLinks } = await supabase
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .in("user_id", studentIds)
    .not("chat_id", "is", null);
  const chatByUser = new Map<string, number>();
  for (const link of tgLinks ?? []) {
    if (link.chat_id) chatByUser.set(link.user_id, Number(link.chat_id));
  }

  // 4. Pull existing reminders for idempotency
  const lessonIds = lessons.map((l: any) => l.id);
  const { data: existingReminders } = await supabase
    .from("lesson_payment_reminders")
    .select("lesson_id, reminder_kind")
    .in("lesson_id", lessonIds);
  const sentSet = new Set(
    (existingReminders ?? []).map((r: any) => `${r.lesson_id}:${r.reminder_kind}`),
  );

  // 5. Pull tutor display names (for nicer messages)
  const { data: tutorProfiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", tutorIds);
  const tutorName = new Map<string, string>();
  for (const p of tutorProfiles ?? []) {
    tutorName.set(
      p.id,
      `${(p.first_name ?? "").trim()} ${(p.last_name ?? "").trim()}`.trim() || "репетитор",
    );
  }

  let sent = 0;
  let skipped = 0;

  for (const lesson of lessons) {
    const settings = settingsByTutor.get(lesson.tutor_id);
    if (!settings) {
      skipped++;
      continue;
    }
    if (!isProActive(settings)) {
      skipped++;
      continue;
    }
    if (!settings.payment_reminder_enabled) {
      skipped++;
      continue;
    }

    const chatId = chatByUser.get(lesson.student_id);
    if (!chatId) {
      skipped++;
      continue;
    }

    const lessonStart = new Date(lesson.starts_at).getTime();
    const days = Math.max(0, Math.min(30, settings.payment_due_days ?? 1));
    const mode = settings.payment_due_mode;

    let reminderKind: string | null = null;
    let triggerTimeMs = 0;

    if (mode === "prepaid") {
      reminderKind = "prepaid";
      triggerTimeMs = new Date(lesson.created_at).getTime();
    } else if (mode === "before_lesson") {
      reminderKind = `before_${days}d`;
      triggerTimeMs = lessonStart - days * DAY_MS;
    } else if (mode === "after_lesson") {
      // Only after the lesson actually happened
      if (lesson.status !== "completed") {
        skipped++;
        continue;
      }
      reminderKind = `after_${days}d`;
      triggerTimeMs = lessonStart + days * DAY_MS;
    }

    if (!reminderKind) {
      skipped++;
      continue;
    }

    // Only fire when trigger time has passed (and at most 2 days late, to avoid spam on backfill)
    const nowMs = now.getTime();
    if (triggerTimeMs > nowMs) {
      skipped++;
      continue;
    }
    if (nowMs - triggerTimeMs > 2 * DAY_MS) {
      skipped++;
      continue;
    }

    const dedupKey = `${lesson.id}:${reminderKind}`;
    if (sentSet.has(dedupKey)) {
      skipped++;
      continue;
    }

    // Compose message
    const dateStr = new Date(lesson.starts_at).toLocaleString("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    const tname = tutorName.get(lesson.tutor_id) ?? "репетитор";
    const price = Number(lesson.student_price ?? 0);
    let header = "💳 Нагадування про оплату";
    let body = "";
    if (mode === "prepaid") {
      body = `Нагадуємо про передоплату за майбутній урок (${dateStr}) з ${tname}.`;
    } else if (mode === "before_lesson") {
      body = `Нагадуємо про оплату уроку ${dateStr} з ${tname}. До початку залишилось ~${days} ${
        days === 1 ? "день" : "днів"
      }.`;
    } else {
      body = `Дякуємо за урок ${dateStr} з ${tname}! Час оплатити заняття.`;
    }
    const priceLine = price > 0 ? `\n\nСума: <b>${price} ₴</b>` : "";
    const text = `${header}\n\n${body}${priceLine}\n\nПредмет: ${lesson.subject}`;

    const ok = await sendTg(TELEGRAM_BOT_TOKEN, chatId, text);
    if (!ok) {
      skipped++;
      continue;
    }

    // Record the send for idempotency
    await supabase.from("lesson_payment_reminders").insert({
      lesson_id: lesson.id,
      tutor_id: lesson.tutor_id,
      student_id: lesson.student_id,
      reminder_kind: reminderKind,
      channel: "telegram",
    });
    sent++;
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: lessons.length, sent, skipped }),
    { headers: { "Content-Type": "application/json" } },
  );
});
