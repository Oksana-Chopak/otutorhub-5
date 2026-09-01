// №15+№21 (ідеї 01.09): вечірній підсумок дня для репетиторів.
// «🌙 Сьогодні: 3 уроки · серія 12 днів 🔥 · ✍️ 2 конспекти чекають» о 21:00 —
// одна приємна причина на день згадати про застосунок (ранковий дайджест
// opt-in і вимкнений за замовчуванням, тож більшість не отримує нічого).
//
// Канали: рядок у notifications (дзвіночок; AFTER INSERT-тригер сам шле
// web-push тим, хто дозволив) + Telegram, якщо привʼязаний.
// Opt-out: tutor_workspace_settings.evening_summary_enabled = false.
// Ідемпотентно за (tutor_id, digest_date, channel='evening') у tutor_daily_digests.
// Викликається pg_cron о 18:00 UTC (21:00 EEST / 20:00 EET) — міграція
// 20260901120002_evening_summary.sql.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "Europe/Kyiv";
const SUPABASE_URL = "https://kficbcjqcbhqhjimxfed.supabase.co";

function todayDateInKyiv(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function dayBoundsKyiv(dateStr: string): { from: string; to: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const kyivHour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", hour12: false,
  }).format(probe));
  const offset = kyivHour - 12;
  return {
    from: new Date(Date.UTC(y, m - 1, d, -offset, 0, 0)).toISOString(),
    to:   new Date(Date.UTC(y, m - 1, d, 24 - offset, 0, 0)).toISOString(),
  };
}

function lessonWord(n: number): string {
  if (n === 1) return "урок";
  if (n >= 2 && n <= 4) return "уроки";
  return "уроків";
}

function noteWord(n: number): string {
  if (n === 1) return "конспект чекає";
  if (n >= 2 && n <= 4) return "конспекти чекають";
  return "конспектів чекають";
}

const CUR_LABEL: Record<string, string> = { UAH: "грн", USD: "$", EUR: "€", GBP: "£", PLN: "zł", SEK: "kr" };
function fmtMoney(byCur: Map<string, number>): string {
  const entries = Array.from(byCur.entries()).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries
    .map(([c, v]) => `${Math.round(v).toLocaleString("uk-UA")} ${CUR_LABEL[c] ?? c}`)
    .join(" + ");
}

async function sendTg(token: string, chatId: number, text: string): Promise<boolean> {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return r.ok;
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN"); // необовʼязковий — дзвіночок працює і без TG

  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret") || "";
  const sb = createClient(SUPABASE_URL, serviceKey);
  const { data: expected } = await sb.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const today = todayDateInKyiv();
  const { from, to } = dayBoundsKyiv(today);

  // Проведені сьогодні уроки (плюс конспекти і гроші з lesson_details)
  const { data: doneToday, error: lessonsErr } = await sb
    .from("lessons")
    .select("id, tutor_id, student_id, source, group_id, lesson_details(student_price, tutor_payout, summary)")
    .eq("status", "completed")
    .gte("starts_at", from)
    .lt("starts_at", to);
  if (lessonsErr) {
    return new Response(JSON.stringify({ error: lessonsErr.message }), { status: 500 });
  }

  type Agg = { count: number; notesMissing: number; pairs: Set<string> };
  const byTutor = new Map<string, Agg>();
  for (const l of doneToday ?? []) {
    const agg = byTutor.get(l.tutor_id) ?? { count: 0, notesMissing: 0, pairs: new Set<string>() };
    agg.count += 1;
    const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
    if (!((d?.summary ?? "").trim())) agg.notesMissing += 1;
    if (l.student_id) agg.pairs.add(l.student_id);
    byTutor.set(l.tutor_id, agg);
  }
  const tutorIds = Array.from(byTutor.keys());
  if (tutorIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no completed lessons today" }));
  }

  // Лише репетитори (менеджер має свій TG-дайджест; учням це не шлеться)
  const { data: roleRows } = await sb
    .from("user_roles").select("user_id, role").in("user_id", tutorIds);
  const tutorRole = new Set((roleRows ?? []).filter((r: any) => r.role === "tutor").map((r: any) => r.user_id));
  const managerRole = new Set((roleRows ?? []).filter((r: any) => r.role === "manager").map((r: any) => r.user_id));

  // Opt-out (default: увімкнено). Якщо колонки ще нема — вважаємо всіх увімкненими.
  const enabled = new Map<string, boolean>();
  {
    const { data: st, error: stErr } = await sb
      .from("tutor_workspace_settings")
      .select("tutor_id, evening_summary_enabled")
      .in("tutor_id", tutorIds);
    if (!stErr) (st ?? []).forEach((s: any) => enabled.set(s.tutor_id, s.evening_summary_enabled !== false));
  }

  // Вже надіслані сьогодні (ідемпотентність)
  const { data: alreadySent } = await sb
    .from("tutor_daily_digests")
    .select("tutor_id")
    .eq("digest_date", today)
    .eq("channel", "evening");
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.tutor_id));

  // Серії
  const { data: streaks } = await sb
    .from("tutor_streaks").select("tutor_id, current_streak").in("tutor_id", tutorIds);
  const streakOf = new Map<string, number>(
    (streaks ?? []).map((s: any) => [s.tutor_id, Number(s.current_streak ?? 0)]));

  // Валюта пари — зі student_rates (у lesson_details валюти немає)
  const { data: rates } = await sb
    .from("student_rates").select("tutor_id, student_id, currency").in("tutor_id", tutorIds);
  const curOfPair = new Map<string, string>(
    (rates ?? []).map((r: any) => [`${r.tutor_id}:${r.student_id}`, r.currency ?? "UAH"]));

  // Telegram-лінки (best effort)
  const { data: tgAll } = await sb
    .from("user_telegram_links").select("user_id, chat_id").in("user_id", tutorIds);
  const chatById = new Map<string, number>(
    (tgAll ?? []).filter((r: any) => r.chat_id).map((r: any) => [r.user_id, Number(r.chat_id)]));

  let sent = 0;
  for (const tutorId of tutorIds) {
    if (!tutorRole.has(tutorId) || managerRole.has(tutorId)) continue; // менеджеру не шлемо
    if (sentSet.has(tutorId)) continue;
    if (enabled.get(tutorId) === false) continue;

    const agg = byTutor.get(tutorId)!;

    // Гроші: по валютах, чесно (без змішування). Індивідуальні уроки:
    // незалежні — student_price; хабові — tutor_payout. Групові (parent-рядок
    // без student_id) грошей тут не мають — рахуємо лише кількість.
    const byCur = new Map<string, number>();
    for (const l of doneToday ?? []) {
      if (l.tutor_id !== tutorId || l.group_id) continue;
      const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
      const amount = l.source === "independent"
        ? Number(d?.student_price ?? 0)
        : Number(d?.tutor_payout ?? 0);
      if (amount <= 0) continue;
      const cur = curOfPair.get(`${tutorId}:${l.student_id}`) ?? "UAH";
      byCur.set(cur, (byCur.get(cur) ?? 0) + amount);
    }

    const bits: string[] = [`${agg.count} ${lessonWord(agg.count)} ✅`];
    const money = fmtMoney(byCur);
    if (money) bits.push(money);
    const streak = streakOf.get(tutorId) ?? 0;
    if (streak >= 2) bits.push(`серія ${streak} дн. 🔥`);
    const title = `🌙 Сьогодні: ${bits.join(" · ")}`;
    let body: string | null = null;
    if (agg.notesMissing > 0) {
      body = `✍️ ${agg.notesMissing} ${noteWord(agg.notesMissing)} на текст — учні їх читають.`;
    }

    // 1) Дзвіночок (+ web-push через AFTER INSERT-тригер)
    const { error: insErr } = await sb.from("notifications").insert({
      user_id: tutorId,
      type: `evening_summary_${today}`,
      title,
      body,
      link: "/dashboard",
    });
    if (insErr) continue; // не позначаємо надісланим — спробуємо наступного разу

    // 2) Telegram — best effort
    const chatId = chatById.get(tutorId);
    if (BOT && chatId) {
      await sendTg(BOT, chatId, body ? `${title}\n${body}` : title).catch(() => false);
    }

    await sb.from("tutor_daily_digests").insert({
      tutor_id: tutorId, digest_date: today, channel: "evening",
    });
    sent += 1;
  }

  return new Response(JSON.stringify({ ok: true, sent, date: today }));
});
