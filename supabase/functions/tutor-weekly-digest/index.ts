// Weekly digest — every Monday 08:00 Kyiv.
// Shows last week stats + upcoming week. All roles: tutors, managers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "Europe/Kyiv";
const SUPABASE_URL = "https://kficbcjqcbhqhjimxfed.supabase.co";

function weekBoundsKyiv(): { from: string; to: string; label: string } {
  const now = new Date();
  const kyivStr = now.toLocaleString("en-CA", { timeZone: TZ });
  const today = new Date(kyivStr.split(",")[0]);
  // Start of current week (Monday)
  const dow = (today.getDay() + 6) % 7; // Mon=0
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  // Last week: Mon to Sun
  const lastMon = new Date(monday); lastMon.setDate(monday.getDate() - 7);
  const lastSun = new Date(monday); lastSun.setDate(monday.getDate() - 1);

  const fmt = (d: Date, h: number) => {
    const probe = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
    const kyivH = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", hour12: false,
    }).format(probe));
    const offset = kyivH - 12;
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h - offset, 0, 0)).toISOString();
  };

  const label = `${lastMon.getDate()}-${lastSun.getDate()} ${
    lastSun.toLocaleString("uk-UA", { month: "long", timeZone: TZ })
  }`;

  return { from: fmt(lastMon, 0), to: fmt(lastSun, 24), label };
}

function nextWeekBoundsKyiv(): { from: string; to: string } {
  const now = new Date();
  const kyivStr = now.toLocaleString("en-CA", { timeZone: TZ });
  const today = new Date(kyivStr.split(",")[0]);
  const dow = (today.getDay() + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  const nextMon = new Date(monday); nextMon.setDate(monday.getDate());
  const nextSun = new Date(monday); nextSun.setDate(monday.getDate() + 6);
  const fmt = (d: Date, h: number) => {
    const probe = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
    const kyivH = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", hour12: false,
    }).format(probe));
    const offset = kyivH - 12;
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h - offset, 0, 0)).toISOString();
  };
  return { from: fmt(nextMon, 0), to: fmt(nextSun, 24) };
}

async function sendTg(token: string, chatId: number, text: string): Promise<boolean> {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML",
      disable_web_page_preview: true }),
  });
  return r.ok;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!BOT || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }

  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret") || "";
  const sb = createClient(SUPABASE_URL, serviceKey);
  const { data: expected } = await sb.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const { from, to, label } = weekBoundsKyiv();
  const { from: nFrom, to: nTo } = nextWeekBoundsKyiv();

  // Telegram links
  const { data: tgAll } = await sb
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .not("chat_id", "is", null);
  const chatById = new Map<string, number>(
    (tgAll ?? []).filter((r: any) => r.chat_id).map((r: any) => [r.user_id, Number(r.chat_id)])
  );
  if (chatById.size === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no telegram users" }));
  }

  const userIds = Array.from(chatById.keys());

  // Profiles, roles
  const { data: profiles } = await sb.from("profiles")
    .select("id, first_name").in("id", userIds);
  const firstName = new Map<string, string>(
    (profiles ?? []).map((p: any) => [p.id, (p.first_name ?? "").trim() || "там"])
  );
  const { data: roles } = await sb.from("user_roles")
    .select("user_id, role").in("user_id", userIds);
  const rolesByUser = new Map<string, Set<string>>();
  for (const r of roles ?? []) {
    if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, new Set());
    rolesByUser.get(r.user_id)!.add(r.role);
  }

  // Last week completed lessons
  const { data: lastWeek } = await sb
    .from("lessons")
    .select("id, tutor_id, student_id, source, lesson_details(student_price, student_payment_status, tutor_payout_status, tutor_payout)")
    .eq("status", "completed")
    .gte("starts_at", from)
    .lt("starts_at", to);

  // Next week scheduled lessons
  const { data: nextWeek } = await sb
    .from("lessons")
    .select("id, tutor_id, source")
    .eq("status", "scheduled")
    .gte("starts_at", nFrom)
    .lt("starts_at", nTo);

  // Unpaid debts
  const { data: unpaid } = await sb
    .from("lessons")
    .select("id, tutor_id, student_id, source, lesson_details(student_price, student_payment_status)")
    .eq("status", "completed")
    .eq("lesson_details.student_payment_status", "unpaid")
    .gt("lesson_details.student_price", 0);

  // Student names for debt list
  const debtStudentIds = Array.from(new Set((unpaid ?? []).map((l: any) => l.student_id)));
  const { data: debtStudents } = debtStudentIds.length
    ? await sb.from("profiles").select("id, first_name, last_name").in("id", debtStudentIds)
    : { data: [] };
  const studentName = new Map<string, string>(
    (debtStudents ?? []).map((p: any) => [
      p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень",
    ])
  );

  let sent = 0;

  for (const userId of userIds) {
    const chatId = chatById.get(userId);
    if (!chatId) continue;
    const userRoles = rolesByUser.get(userId) ?? new Set();
    const isManager = userRoles.has("manager");
    const isTutor = userRoles.has("tutor");
    if (!isManager && !isTutor) continue;

    const name = firstName.get(userId) ?? "";
    const lines: string[] = [];

    if (isManager) {
      const wLessons = (lastWeek ?? []).filter((l: any) => l.source !== "independent");
      const nLessons = (nextWeek ?? []).filter((l: any) => l.source !== "independent");
      const income = wLessons.reduce((s: number, l: any) =>
        s + Number(l.lesson_details?.student_price ?? 0), 0);
      const wDebts = (unpaid ?? []).filter((l: any) => l.source !== "independent");
      const debtTotal = wDebts.reduce((s: number, l: any) =>
        s + Number(l.lesson_details?.student_price ?? 0), 0);
      const debtStudents = new Set(wDebts.map((l: any) => l.student_id)).size;

      lines.push(`📊 <b>Тиждень ${label} — підсумки центру</b>`);
      lines.push("");
      lines.push(`🏫 Проведено: <b>${wLessons.length} уроків</b>`);
      lines.push(`💰 Зароблено: <b>${income} ₴</b>`);
      if (debtStudents > 0) {
        lines.push("");
        lines.push(`💳 Борги учнів: ${debtStudents} учнів · <b>${debtTotal} ₴</b>`);
        const top = Array.from(
          wDebts.reduce((m: Map<string, number>, l: any) => {
            const k = l.student_id;
            m.set(k, (m.get(k) ?? 0) + Number(l.lesson_details?.student_price ?? 0));
            return m;
          }, new Map<string, number>())
        ).sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [sid, amt] of top) {
          lines.push(`  • ${esc(studentName.get(sid))} — ${amt} ₴`);
        }
      }
      lines.push("");
      lines.push(`📅 Наступний тиждень: <b>${nLessons.length} уроків</b> заплановано`);
      lines.push("");
      lines.push(`Гарного тижня, ${esc(name)}! 💪`);

    } else {
      const wLessons = (lastWeek ?? []).filter((l: any) => l.tutor_id === userId);
      const nLessons = (nextWeek ?? []).filter((l: any) => l.tutor_id === userId);
      const income = wLessons.reduce((s: number, l: any) =>
        s + Number(l.lesson_details?.student_price ?? 0), 0);
      const myDebts = (unpaid ?? []).filter((l: any) => l.tutor_id === userId);
      const debtTotal = myDebts.reduce((s: number, l: any) =>
        s + Number(l.lesson_details?.student_price ?? 0), 0);
      const debtStudents = new Set(myDebts.map((l: any) => l.student_id)).size;

      if (wLessons.length === 0 && nLessons.length === 0) continue;

      lines.push(`🎉 <b>Тиждень ${label}</b> — завершено!`);
      lines.push("");
      lines.push(`📚 Проведено: <b>${wLessons.length} уроків</b>`);
      if (income > 0) lines.push(`💰 Зароблено: <b>${income} ₴</b>`);
      if (debtStudents > 0) {
        lines.push("");
        lines.push(`💳 Очікують оплати: ${debtStudents} учнів · <b>${debtTotal} ₴</b>`);
        const top = Array.from(
          myDebts.reduce((m: Map<string, number>, l: any) => {
            const k = l.student_id;
            m.set(k, (m.get(k) ?? 0) + Number(l.lesson_details?.student_price ?? 0));
            return m;
          }, new Map<string, number>())
        ).sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [sid, amt] of top) {
          lines.push(`  • ${esc(studentName.get(sid))} — ${amt} ₴`);
        }
      }
      lines.push("");
      if (nLessons.length > 0) {
        lines.push(`📅 Наступний тиждень: <b>${nLessons.length} уроків</b> заплановано`);
      } else {
        lines.push(`📅 Наступного тижня уроків ще немає — саме час заповнити розклад!`);
      }
      lines.push("");
      lines.push(`Гарного тижня, ${esc(name)}! 🌟`);
    }

    const ok = await sendTg(BOT, chatId, lines.join("\n"));
    if (ok) sent++;
  }

  return new Response(JSON.stringify({ ok: true, week: label, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
