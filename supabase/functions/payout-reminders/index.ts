// Daily, same-day Telegram + web-push reminder to the hub manager(s) about tutor
// payouts due TODAY (per each tutor's schedule in tutor_details.payout_*).
// Mirrors the dashboard "💰 Час виплати" card, but proactive. Run once each
// morning via pg_cron with get_cron_shared_secret().
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWebPush } from "../_shared/push.ts";

interface Sched {
  payout_frequency: string | null;
  payout_weekday: number | null;
  payout_monthday: number | null;
  payout_anchor: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Same logic as src/lib/payoutSchedule.ts, evaluated in the given local date.
function isPayoutDueToday(s: Sched, today: Date): boolean {
  if (!s.payout_frequency) return false;
  const t = startOfDay(today);
  if (s.payout_frequency === "weekly") {
    return s.payout_weekday != null && t.getDay() === s.payout_weekday;
  }
  if (s.payout_frequency === "biweekly") {
    if (s.payout_weekday == null || t.getDay() !== s.payout_weekday) return false;
    const anchor = s.payout_anchor ? startOfDay(new Date(s.payout_anchor)) : new Date(0);
    const weeks = Math.round((t.getTime() - startOfDay(anchor).getTime()) / (7 * DAY));
    return weeks % 2 === 0;
  }
  if (s.payout_frequency === "monthly") {
    return s.payout_monthday != null && t.getDate() === s.payout_monthday;
  }
  return false;
}

function escapeHtml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTg(botToken: string, chatId: number, text: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey);

  // Cron shared-secret auth (same scheme as the other crons).
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret");
  const { data: expected } = await admin.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  // "Today" in Kyiv wall-clock, so weekday/date match what the manager sees.
  const kyivNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const todayStr = kyivNow.toISOString().slice(0, 10);

  // 1. Tutors with a payout schedule.
  const { data: tutors } = await admin
    .from("tutor_details")
    .select("user_id, payout_frequency, payout_weekday, payout_monthday, payout_anchor")
    .not("payout_frequency", "is", null);

  const due = (tutors ?? []).filter((s: any) => isPayoutDueToday(s, kyivNow));
  if (due.length === 0) {
    return new Response(JSON.stringify({ ok: true, scanned: tutors?.length ?? 0, due: 0, sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  const dueIds = due.map((s: any) => s.user_id);

  // 2. Unpaid payout sums per due tutor.
  // NOTE: tutor_payout + tutor_payout_status live on lesson_details, NOT on lessons
  // (the financial columns were moved off the lessons table). Reading them from lessons
  // returned nothing, so payout reminders silently never fired. Source them from
  // lesson_details, joined back to the lesson's tutor via lesson_id.
  const { data: dueLessons } = await admin
    .from("lessons")
    .select("id, tutor_id")
    .in("tutor_id", dueIds)
    .neq("status", "cancelled");
  const tutorByLesson = new Map<string, string>();
  for (const l of (dueLessons ?? []) as any[]) tutorByLesson.set(l.id, l.tutor_id);

  const sumBy = new Map<string, number>();
  const cntBy = new Map<string, number>();
  const lessonIds = [...tutorByLesson.keys()];
  if (lessonIds.length > 0) {
    const { data: details } = await admin
      .from("lesson_details")
      .select("lesson_id, tutor_payout, tutor_payout_status")
      .in("lesson_id", lessonIds)
      .eq("tutor_payout_status", "unpaid");
    for (const d of (details ?? []) as any[]) {
      const tid = tutorByLesson.get(d.lesson_id);
      if (!tid) continue;
      sumBy.set(tid, (sumBy.get(tid) ?? 0) + (Number(d.tutor_payout) || 0));
      cntBy.set(tid, (cntBy.get(tid) ?? 0) + 1);
    }
  }

  // Only remind about tutors who actually have something to pay today.
  const payable = dueIds.filter((id: string) => (sumBy.get(id) ?? 0) > 0);
  if (payable.length === 0) {
    return new Response(JSON.stringify({ ok: true, scanned: tutors?.length ?? 0, due: due.length, sent: 0, note: "nothing_unpaid" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Tutor names.
  const { data: profs } = await admin.from("profiles").select("id, first_name, last_name").in("id", payable);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as any[]) {
    nameById.set(p.id, `${(p.first_name ?? "").trim()} ${(p.last_name ?? "").trim()}`.trim() || "репетитор");
  }

  // 4. Managers + their Telegram chats.
  const { data: mgrRoles } = await admin.from("user_roles").select("user_id").eq("role", "manager");
  const managerIds = Array.from(new Set((mgrRoles ?? []).map((m: any) => m.user_id)));
  const { data: tgLinks } = await admin
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .in("user_id", managerIds)
    .not("chat_id", "is", null);
  const chatByMgr = new Map<string, number>();
  for (const link of (tgLinks ?? []) as any[]) {
    if (link.chat_id) chatByMgr.set(link.user_id, Number(link.chat_id));
  }

  const lines = payable.map((id: string) => {
    const sum = sumBy.get(id) ?? 0;
    const cnt = cntBy.get(id) ?? 0;
    return `• <b>${escapeHtml(nameById.get(id) ?? "репетитор")}</b> — ${sum.toLocaleString("uk-UA")} ₴ (${cnt} ур.)`;
  });
  const plainLines = payable.map((id: string) => {
    const sum = sumBy.get(id) ?? 0;
    return `${nameById.get(id) ?? "репетитор"} — ${sum.toLocaleString("uk-UA")} ₴`;
  });
  const tgText = `💰 <b>Сьогодні виплати репетиторам</b>\n${lines.join("\n")}\n\nВідкрийте Фінанси, щоб позначити виплаченими.`;

  let sent = 0;
  for (const mgrId of managerIds) {
    // Dedup: once per manager per day.
    const dedupType = `payout_due_${todayStr}`;
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", mgrId)
      .eq("type", dedupType)
      .gte("created_at", `${todayStr}T00:00:00Z`)
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const chatId = chatByMgr.get(mgrId);
    const tgOk = chatId ? await sendTg(TELEGRAM_BOT_TOKEN ?? "", chatId, tgText) : false;
    const pushOk = await sendWebPush(supabaseUrl, serviceKey, {
      userId: mgrId,
      title: "💰 Час виплат репетиторам",
      body: plainLines.join("; ").slice(0, 160),
      link: "/finances",
      tag: `payout-${todayStr}`,
    });
    // In-app bell + dedup record.
    await admin.from("notifications").insert({
      user_id: mgrId,
      type: dedupType,
      title: "💰 Час виплат репетиторам",
      body: plainLines.join("; "),
      link: "/finances",
    });
    if (tgOk || pushOk) sent++;
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: tutors?.length ?? 0, due: due.length, payable: payable.length, sent }),
    { headers: { "Content-Type": "application/json" } },
  );
});
