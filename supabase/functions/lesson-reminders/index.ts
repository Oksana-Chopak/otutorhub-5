// Sends Telegram reminders to tutor and student before a lesson starts.
// Two reminders: 60 minutes before and 15 minutes before.
// Idempotent via lesson_reminders log. Run on a cron every 5 minutes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPush } from "../_shared/push.ts";
import { withJob } from "../_shared/jobRun.ts";
import { versionProbe } from "../_shared/build.ts";

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

Deno.serve(withJob("lesson-reminders", async (req) => {
  /* 01.10: проба версії СТОЇТЬ ПЕРШОЮ — без даних і до будь-якої перевірки
     доступу. Доти цю cron-функцію ззовні неможливо було спитати, чи вона
     передеплоєна: робот бачив лише пʼять функцій із пробою, а саме у кронів
     застарілий код непомітний — вони відповідають однаково. */
  const probe = versionProbe(req, "lesson-reminders");
  if (probe) return probe;
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

  /* 01.10 — ГРУПОВІ УРОКИ. У них `lessons.student_id` = NULL (учні звʼязані
     через `lesson_participants`), а цей сканер жодного фільтра по групових не
     має. Через це нагадування для ШКІЛ були зламані в обидва боки:
       • учень групового уроку не отримував НІЧОГО: `chatByUser.get(null)` →
         undefined, `sendWebPush({ userId: null })` → в пустоту;
       • журнал дедупу падав на `student_id uuid NOT NULL`, а провал запису лише
         логується — тобто репетитору ТЕ САМЕ нагадування приходило кожні 5
         хвилин до кінця вікна: до ~18 разів на «відмітьте статус» (вікно 90 хв)
         і до ~72 на добове (вікно 6 год).
     Групові уроки — це продукт шкіл, тобто било саме по платних школах. */
  const groupLessonIds = lessons.filter((l: any) => !l.student_id).map((l: any) => l.id);
  const participantsByLesson = new Map<string, string[]>();
  if (groupLessonIds.length) {
    const { data: parts, error: partsErr } = await supabase
      .from("lesson_participants")
      .select("lesson_id, student_id")
      .in("lesson_id", groupLessonIds);
    if (partsErr) console.error("lesson-reminders: учасників груп не прочитано —", partsErr.message);
    for (const pr of (parts ?? []) as any[]) {
      if (!pr.student_id) continue;
      participantsByLesson.set(pr.lesson_id, [...(participantsByLesson.get(pr.lesson_id) ?? []), pr.student_id]);
    }
    // Сортуємо, щоб «перший учасник» був той самий між запусками крона.
    for (const [k, v] of participantsByLesson) participantsByLesson.set(k, [...v].sort());
  }
  /** Кому адресований урок: індивідуальний — учневі, груповий — усім учасникам. */
  const studentsOf = (l: any): string[] =>
    l.student_id ? [l.student_id as string] : (participantsByLesson.get(l.id) ?? []);
  /** Що писати в колонку `student_id` журналу. Дедуп тримає
   *  UNIQUE(lesson_id, recipient_id, reminder_kind) — цієї колонки в ключі немає
   *  і ніхто її не читає (єдине читання журналу бере lesson_id/recipient_id/kind),
   *  тож для групового уроку беремо ПЕРШОГО учасника. Якщо учасників немає —
   *  дедупити нічим, і тоді ми НЕ надсилаємо: мовчання краще за спам кожні 5 хв. */
  const logStudentOf = (l: any): string | null => studentsOf(l)[0] ?? null;

  // Fetch telegram links for all relevant users
  const userIds = Array.from(new Set([
    ...lessons.flatMap((l: any) => [l.tutor_id, l.student_id]),
    ...Array.from(participantsByLesson.values()).flat(),
  ].filter(Boolean)));
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
        // Груповий урок — кожному учаснику окремо (у нього свій чат і свій журнал).
        for (const sid of studentsOf(lesson)) {
        const studentChat = chatByUser.get(sid);
        const fbKey = `${lesson.id}:${sid}:feedback_nudge`;
        if (!sentSet.has(fbKey)) {
          const tutorName = nameById.get(lesson.tutor_id) ?? "репетитором";
          const text =
            `⭐ Як пройшов урок з <b>${escapeHtml(tutorName)}</b> (${escapeHtml(lesson.subject)})?\n\n` +
            `Відкрийте урок у застосунку і поставте оцінку — це допоможе репетитору і іншим учням.`;
          const tgOk = studentChat ? await sendTg(TELEGRAM_BOT_TOKEN, studentChat, text) : false;
          const pushOk = await sendWebPush(supabaseUrl, serviceKey, {
            userId: sid,
            title: "⭐ Як пройшов урок?",
            body: `Оцініть урок з ${tutorName} (${lesson.subject})`,
            link: "/student-dashboard",
            tag: `lesson-${lesson.id}-feedback`,
          });
          if (tgOk || pushOk) {
            const { error: logErr } = await supabase.from("lesson_reminders").insert({
              lesson_id: lesson.id,
              tutor_id: lesson.tutor_id,
              student_id: sid,
              recipient_id: sid,
              recipient_role: "student",
              reminder_kind: "feedback_nudge",
              channel: tgOk ? "telegram" : "webpush",
            });
            // 18.09: на цьому журналі тримається дедуп — крон біжить раз на 5 хвилин.
            // Мовчазний провал запису означав би те саме нагадування кожні 5 хв, поки
            // не закінчиться вікно. Рівно так уже ламались нагадування про оплату.
            if (logErr) console.error("lesson-reminders: журнал не записався — дедуп зламано", logErr.message);
            sent++;
          } else skipped++;
        }
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
        if (sentSet.has(key)) continue;
        /* Без учасників груповий урок дедупити нічим — тоді не надсилаємо:
           мовчання краще за те саме нагадування кожні 5 хвилин. */
        const logSid = logStudentOf(lesson);
        if (!logSid) continue;
        const studentName = lesson.student_id
          ? (nameById.get(lesson.student_id) ?? "учнем")
          : `групою (${studentsOf(lesson).length})`;
        const dateStr = new Date(lesson.starts_at).toLocaleString("uk-UA", {
          timeZone: "Europe/Kyiv",
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        });
        const text =
          `📝 Урок з <b>${escapeHtml(studentName)}</b> (${escapeHtml(lesson.subject)}) ${dateStr} вже мав відбутися.\n\n` +
          `Будь ласка, відмітьте у застосунку: <b>Проведено</b> ✅ або <b>Скасовано</b> ❌.\n` +
          `Без статусу оплата за урок не нараховується.`;
        const tgOk = tutorChat ? await sendTg(TELEGRAM_BOT_TOKEN, tutorChat, text) : false;
        const pushOk = await sendWebPush(supabaseUrl, serviceKey, {
          userId: lesson.tutor_id,
          title: "📝 Відмітьте статус уроку",
          body: `${studentName} · ${lesson.subject} · ${dateStr}`,
          link: "/schedule",
          tag: `lesson-${lesson.id}-${n.kind}`,
        });
        if (tgOk || pushOk) {
          const { error: logErr } = await supabase.from("lesson_reminders").insert({
            lesson_id: lesson.id,
            tutor_id: lesson.tutor_id,
            student_id: logSid,
            recipient_id: lesson.tutor_id,
            recipient_role: "tutor",
            reminder_kind: n.kind,
            channel: tgOk ? "telegram" : "webpush",
          });
          // 18.09: на цьому журналі тримається дедуп — крон біжить раз на 5 хвилин.
          // Мовчазний провал запису означав би те саме нагадування кожні 5 хв, поки
          // не закінчиться вікно. Рівно так уже ламались нагадування про оплату.
          if (logErr) console.error("lesson-reminders: журнал не записався — дедуп зламано", logErr.message);
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
      const preLogSid = logStudentOf(lesson);
      // Груповий урок без учасників дедупити нічим — краще тиша, ніж кожні 5 хв.
      if (!preLogSid) continue;
      const studentName = lesson.student_id
        ? (nameById.get(lesson.student_id) ?? "учень")
        : `групою (${studentsOf(lesson).length})`;
      const tutorName = nameById.get(lesson.tutor_id) ?? "репетитор";
      const link = lesson.meeting_url
        ? `\n\n🔗 <a href="${escapeHtmlAttr(String(lesson.meeting_url))}">Посилання на урок</a>`
        : "\n\n⚠️ Посилання на урок ще не додано.";

      // Send to tutor
      const tutorChat = chatByUser.get(lesson.tutor_id);
      const tutorKey = `${lesson.id}:${lesson.tutor_id}:${rule.kind}`;
      if (!sentSet.has(tutorKey)) {
        const text =
          `⏰ Урок з <b>${escapeHtml(studentName)}</b> через ${rule.minutesBefore} хв\n` +
          `📚 ${escapeHtml(lesson.subject)}\n📅 ${dateStr}${link}`;
        const tgOk = tutorChat ? await sendTg(TELEGRAM_BOT_TOKEN, tutorChat, text) : false;
        const pushOk = await sendWebPush(supabaseUrl, serviceKey, {
          userId: lesson.tutor_id,
          title: `⏰ Урок через ${rule.minutesBefore} хв`,
          body: `${studentName} · ${lesson.subject} · ${dateStr}`,
          link: "/schedule",
          tag: `lesson-${lesson.id}-${rule.kind}`,
        });
        if (tgOk || pushOk) {
          const { error: logErr } = await supabase.from("lesson_reminders").insert({
            lesson_id: lesson.id,
            tutor_id: lesson.tutor_id,
            student_id: preLogSid,
            recipient_id: lesson.tutor_id,
            recipient_role: "tutor",
            reminder_kind: rule.kind,
            channel: tgOk ? "telegram" : "webpush",
          });
          // 18.09: на цьому журналі тримається дедуп — крон біжить раз на 5 хвилин.
          // Мовчазний провал запису означав би те саме нагадування кожні 5 хв, поки
          // не закінчиться вікно. Рівно так уже ламались нагадування про оплату.
          if (logErr) console.error("lesson-reminders: журнал не записався — дедуп зламано", logErr.message);
          sent++;
        } else skipped++;
      }

      // Send to student — у груповому уроці КОЖНОМУ учаснику окремо: доти
      // `chatByUser.get(null)` і `sendWebPush({ userId: null })` відправляли
      // нагадування в пустоту, і учні шкіл не отримували їх узагалі.
      for (const sid of studentsOf(lesson)) {
      const studentChat = chatByUser.get(sid);
      const studentKey = `${lesson.id}:${sid}:${rule.kind}`;
      if (!sentSet.has(studentKey)) {
        const text =
          `⏰ Урок з <b>${escapeHtml(tutorName)}</b> через ${rule.minutesBefore} хв\n` +
          `📚 ${escapeHtml(lesson.subject)}\n📅 ${dateStr}${link}`;
        const tgOk = studentChat ? await sendTg(TELEGRAM_BOT_TOKEN, studentChat, text) : false;
        const pushOk = await sendWebPush(supabaseUrl, serviceKey, {
          userId: sid,
          title: `⏰ Урок через ${rule.minutesBefore} хв`,
          body: `${tutorName} · ${lesson.subject} · ${dateStr}`,
          // 24.09 (аудит шляхів): вело на список, де урок треба знайти очима.
          // Тепер сторінка учня сама прокручує до цього уроку (кнопка
          // «Приєднатися» — на ньому ж). Посилання лишається на своєму домені:
          // service worker навмисно не пускає зовнішні адреси.
          link: `/student/schedule?lesson=${lesson.id}`,
          tag: `lesson-${lesson.id}-${rule.kind}`,
        });
        if (tgOk || pushOk) {
          const { error: logErr } = await supabase.from("lesson_reminders").insert({
            lesson_id: lesson.id,
            tutor_id: lesson.tutor_id,
            student_id: sid,
            recipient_id: sid,
            recipient_role: "student",
            reminder_kind: rule.kind,
            channel: tgOk ? "telegram" : "webpush",
          });
          // 18.09: на цьому журналі тримається дедуп — крон біжить раз на 5 хвилин.
          // Мовчазний провал запису означав би те саме нагадування кожні 5 хв, поки
          // не закінчиться вікно. Рівно так уже ламались нагадування про оплату.
          if (logErr) console.error("lesson-reminders: журнал не записався — дедуп зламано", logErr.message);
          sent++;
        } else skipped++;
      }
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: lessons.length, sent, skipped, autoCompleted }),
    { headers: { "Content-Type": "application/json" } },
  );
}));
