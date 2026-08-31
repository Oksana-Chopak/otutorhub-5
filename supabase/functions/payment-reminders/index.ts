// Sends Telegram payment reminders to students based on each tutor's Pro rules.
// Should be invoked on a schedule (cron). Idempotent via lesson_payment_reminders log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPush } from "../_shared/push.ts";

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

// ── i18n сповіщень: мова одержувача з profiles.preferred_language ──
const RLOC: Record<string, string> = { uk: "uk-UA", en: "en-GB", sv: "sv-SE" };
const RSYM: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", GBP: "£", SEK: "kr", PLN: "zł" };
const rsym = (c?: string | null) => RSYM[c ?? "UAH"] ?? (c ?? "₴");
const RT = {
  uk: {
    header: "💳 Нагадування про оплату", tutor: "репетитор", sum: "Сума", subj: "Предмет",
    prepaid: (d: string, t: string) => `Нагадуємо про передоплату за майбутній урок (${d}) з ${t}.`,
    before: (d: string, t: string, n: number) => `Нагадуємо про оплату уроку ${d} з ${t}. До початку залишилось ~${n} ${n === 1 ? "день" : "днів"}.`,
    after: (d: string, t: string) => `Дякуємо за урок ${d} з ${t}! Час оплатити заняття.`,
    gPrepaid: (d: string, t: string) => `Нагадуємо про передоплату за майбутній груповий урок (${d}) з ${t}.`,
    gPay: (d: string, t: string) => `Груповий урок ${d} з ${t} — час оплатити заняття.`,
  },
  en: {
    header: "💳 Payment reminder", tutor: "your tutor", sum: "Amount", subj: "Subject",
    prepaid: (d: string, t: string) => `A prepayment reminder for the upcoming lesson (${d}) with ${t}.`,
    before: (d: string, t: string, n: number) => `Payment reminder for the lesson ${d} with ${t}. ~${n} ${n === 1 ? "day" : "days"} to go.`,
    after: (d: string, t: string) => `Thanks for the lesson ${d} with ${t}! Time to pay for it.`,
    gPrepaid: (d: string, t: string) => `A prepayment reminder for the upcoming group lesson (${d}) with ${t}.`,
    gPay: (d: string, t: string) => `Group lesson ${d} with ${t} — time to pay.`,
  },
  sv: {
    header: "💳 Betalningspåminnelse", tutor: "din lärare", sum: "Belopp", subj: "Ämne",
    prepaid: (d: string, t: string) => `Påminnelse om förskottsbetalning för kommande lektion (${d}) med ${t}.`,
    before: (d: string, t: string, n: number) => `Betalningspåminnelse för lektionen ${d} med ${t}. ~${n} ${n === 1 ? "dag" : "dagar"} kvar.`,
    after: (d: string, t: string) => `Tack för lektionen ${d} med ${t}! Dags att betala.`,
    gPrepaid: (d: string, t: string) => `Påminnelse om förskottsbetalning för kommande grupplektion (${d}) med ${t}.`,
    gPay: (d: string, t: string) => `Grupplektion ${d} med ${t} — dags att betala.`,
  },
} as const;
type RtLang = keyof typeof RT;

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

  // B5: нічний спокій — 09:00–21:00 за Києвом; cron лишається щогодинним.
  const kyivHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Kyiv" }).format(new Date()));
  if (kyivHour < 9 || kyivHour >= 21) {
    return new Response(JSON.stringify({ ok: true, skipped: "night", kyivHour }), { status: 200, headers: { "Content-Type": "application/json" } });
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
  // B8: мова кожного одержувача (default uk) — одним запитом.
  const allRecipientIds = [...new Set([
    ...(lessons ?? []).map((l: { student_id?: string | null }) => l.student_id).filter(Boolean),
    ...(gParts ?? []).map((p: { student_id: string }) => p.student_id),
  ])] as string[];
  const langByUser = new Map<string, RtLang>();
  if (allRecipientIds.length) {
    const { data: langRows } = await supabase.from("profiles").select("id, preferred_language").in("id", allRecipientIds);
    for (const r of langRows ?? []) {
      const v = (r as { preferred_language?: string }).preferred_language;
      langByUser.set((r as { id: string }).id, v === "en" ? "en" : v === "sv" ? "sv" : "uk");
    }
  }
  const rlang = (id: string): RtLang => langByUser.get(id) ?? "uk";
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
    const lang = rlang(lesson.student_id);
    const T = RT[lang];
    const cur = rsym((lesson as { currency?: string | null }).currency);
    const dateStr = new Date(lesson.starts_at).toLocaleString(RLOC[lang], {
      timeZone: "Europe/Kyiv",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    const tname = tutorName.get(lesson.tutor_id) ?? T.tutor;
    const price = Number(lesson.student_price ?? 0);
    const header = T.header;
    let body = "";
    if (mode === "prepaid") body = T.prepaid(dateStr, tname);
    else if (mode === "before_lesson") body = T.before(dateStr, tname, days);
    else body = T.after(dateStr, tname);
    const priceLine = price > 0 ? `\n\n${T.sum}: <b>${price} ${cur}</b>` : "";
    const text = `${header}\n\n${escapeHtml(body)}${priceLine}\n\n${T.subj}: ${escapeHtml(lesson.subject)}`;

    const tgOk = chatId ? await sendTg(TELEGRAM_BOT_TOKEN, chatId, text) : false;
    const pushOk = await sendWebPush(supabaseUrl, serviceKey, {
      userId: lesson.student_id,
      title: header,
      body: `${body}${price > 0 ? ` ${T.sum}: ${price} ${cur}.` : ""}`,
      link: "/student/payments",
      tag: `payrem-${lesson.id}`,
    });
    // In-app 🔔 bell — the universal channel every student sees in the app, whether or
    // not they linked Telegram or granted web-push. The dedup guard above means this
    // fires at most once per (lesson, reminderKind), so no hourly spam. (Previously we
    // skipped entirely when tg+push both failed — students without either got nothing.)
    await supabase.from("notifications").insert({
      user_id: lesson.student_id,
      type: "payment_reminder",
      title: header,
      body: `${body}${price > 0 ? ` ${T.sum}: ${price} ${cur}.` : ""}`,
      link: "/student/payments",
    });

    // Record the send for idempotency (bell always delivered; note best push channel).
    await supabase.from("lesson_payment_reminders").insert({
      lesson_id: lesson.id,
      tutor_id: lesson.tutor_id,
      student_id: lesson.student_id,
      reminder_kind: reminderKind,
      channel: tgOk ? "telegram" : pushOk ? "webpush" : "inapp",
    });
    sent++;
  }

  // ===== GROUP LESSONS: per-participant reminders (lesson_participants) =====
  // Group lessons have lessons.student_id = NULL and NO lesson_details row — their
  // per-student price/payment live on lesson_participants. Mirror the individual logic
  // for each UNPAID participant, deduped on (lesson, student, reminderKind). This is the
  // path that was entirely missing before, so group students got no automated reminders.
  const { data: partsRaw } = await supabase
    .from("lesson_participants")
    .select(
      "student_id, student_price, student_payment_status, lesson_id, lessons!inner(id, tutor_id, starts_at, status, subject, created_at)",
    )
    .neq("student_payment_status", "paid")
    .in("lessons.status", ["scheduled", "completed"])
    .gte("lessons.starts_at", fromIso)
    .lte("lessons.starts_at", toIso);

  const parts = (partsRaw ?? [])
    .map((p: any) => ({
      student_id: p.student_id,
      student_price: p.student_price,
      lesson: p.lessons,
    }))
    .filter((p: any) => p.lesson);

  if (parts.length > 0) {
    // Load settings / names / telegram for any group tutors+students not already cached.
    const gTutorIds = Array.from(new Set(parts.map((p: any) => p.lesson.tutor_id))).filter((id) => !settingsByTutor.has(id as string));
    if (gTutorIds.length) {
      const { data: gs } = await supabase
        .from("tutor_workspace_settings")
        .select("tutor_id, payment_reminder_enabled, payment_due_mode, payment_due_days, subscription_status, subscription_until, trial_until")
        .in("tutor_id", gTutorIds);
      for (const s of gs ?? []) settingsByTutor.set(s.tutor_id, s as WorkspaceSettings);
      const { data: gp } = await supabase.from("profiles").select("id, first_name, last_name").in("id", gTutorIds);
      for (const p of gp ?? []) tutorName.set(p.id, `${(p.first_name ?? "").trim()} ${(p.last_name ?? "").trim()}`.trim() || "репетитор");
    }
    const gStudentIds = Array.from(new Set(parts.map((p: any) => p.student_id))).filter((id) => !chatByUser.has(id as string));
    if (gStudentIds.length) {
      const { data: gl } = await supabase.from("user_telegram_links").select("user_id, chat_id").in("user_id", gStudentIds).not("chat_id", "is", null);
      for (const link of gl ?? []) if (link.chat_id) chatByUser.set(link.user_id, Number(link.chat_id));
    }
    // Dedup: existing group reminders keyed lesson:student:kind (student included, unlike individual).
    const gLessonIds = Array.from(new Set(parts.map((p: any) => p.lesson.id)));
    const { data: gExisting } = await supabase.from("lesson_payment_reminders").select("lesson_id, student_id, reminder_kind").in("lesson_id", gLessonIds);
    const gSentSet = new Set((gExisting ?? []).map((r: any) => `${r.lesson_id}:${r.student_id}:${r.reminder_kind}`));

    for (const p of parts) {
      const lesson = p.lesson;
      const settings = settingsByTutor.get(lesson.tutor_id);
      if (!settings || !isProActive(settings) || !settings.payment_reminder_enabled) { skipped++; continue; }

      const days = Math.max(0, Math.min(30, settings.payment_due_days ?? 1));
      const mode = settings.payment_due_mode;
      const lessonStart = new Date(lesson.starts_at).getTime();
      let reminderKind: string | null = null;
      let triggerTimeMs = 0;
      if (mode === "prepaid") { reminderKind = "prepaid"; triggerTimeMs = new Date(lesson.created_at).getTime(); }
      else if (mode === "before_lesson") { reminderKind = `before_${days}d`; triggerTimeMs = lessonStart - days * DAY_MS; }
      else if (mode === "after_lesson") { if (lesson.status !== "completed") { skipped++; continue; } reminderKind = `after_${days}d`; triggerTimeMs = lessonStart + days * DAY_MS; }
      if (!reminderKind) { skipped++; continue; }

      const nowMs = now.getTime();
      if (triggerTimeMs > nowMs || nowMs - triggerTimeMs > 2 * DAY_MS) { skipped++; continue; }
      if (gSentSet.has(`${lesson.id}:${p.student_id}:${reminderKind}`)) { skipped++; continue; }

      const lang = rlang(p.student_id);
      const T = RT[lang];
      const cur = rsym((lesson as { currency?: string | null }).currency);
      const dateStr = new Date(lesson.starts_at).toLocaleString(RLOC[lang], { timeZone: "Europe/Kyiv", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
      const tname = tutorName.get(lesson.tutor_id) ?? T.tutor;
      const price = Number(p.student_price ?? 0);
      const header = T.header;
      const body = mode === "prepaid" ? T.gPrepaid(dateStr, tname) : T.gPay(dateStr, tname);
      const priceLine = price > 0 ? `\n\n${T.sum}: <b>${price} ${cur}</b>` : "";
      const text = `${header}\n\n${escapeHtml(body)}${priceLine}\n\n${T.subj}: ${escapeHtml(lesson.subject)}`;

      const chatId = chatByUser.get(p.student_id);
      const tgOk = chatId ? await sendTg(TELEGRAM_BOT_TOKEN, chatId, text) : false;
      const pushOk = await sendWebPush(supabaseUrl, serviceKey, {
        userId: p.student_id,
        title: header,
        body: `${body}${price > 0 ? ` ${T.sum}: ${price} ${cur}.` : ""}`,
        link: "/student/payments",
        tag: `payrem-${lesson.id}-${p.student_id}`,
      });
      // In-app 🔔 — universal channel (same as individual path).
      await supabase.from("notifications").insert({
        user_id: p.student_id,
        type: "payment_reminder",
        title: header,
        body: `${body}${price > 0 ? ` ${T.sum}: ${price} ${cur}.` : ""}`,
        link: "/student/payments",
      });
      await supabase.from("lesson_payment_reminders").insert({
        lesson_id: lesson.id,
        tutor_id: lesson.tutor_id,
        student_id: p.student_id,
        reminder_kind: reminderKind,
        channel: tgOk ? "telegram" : pushOk ? "webpush" : "inapp",
      });
      sent++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: lessons.length, groupParticipants: parts.length, sent, skipped }),
    { headers: { "Content-Type": "application/json" } },
  );
});
