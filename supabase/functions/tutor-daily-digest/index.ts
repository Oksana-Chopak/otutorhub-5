// Daily morning digest — all roles: independent tutors, hired tutors, managers.
// Idempotent per (user_id, digest_date) via tutor_daily_digests.
// Invoked by pg_cron at 06:00 UTC (08:00 EET / 09:00 EEST).
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

function lessonWord(n: number): string {
  if (n === 1) return "урок";
  if (n >= 2 && n <= 4) return "уроки";
  return "уроків";
}

function greet(firstName: string): string {
  const h = new Date().toLocaleString("en-GB", { timeZone: TZ, hour: "numeric", hour12: false });
  const hour = Number(h);
  if (hour < 12) return `🌤️ Привіт, ${esc(firstName)}!`;
  if (hour < 17) return `☀️ Привіт, ${esc(firstName)}!`;
  return `🌙 Привіт, ${esc(firstName)}!`;
}

Deno.serve(async (req) => {
  const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!BOT || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }

  // Auth: verify cron shared secret
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret") || "";
  const sb = createClient(SUPABASE_URL, serviceKey);
  const { data: expected } = await sb.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const today = todayDateInKyiv();
  const { from, to } = dayBoundsKyiv(today);

  // Already sent today?
  const { data: alreadySent } = await sb
    .from("tutor_daily_digests")
    .select("tutor_id")
    .eq("digest_date", today);
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.tutor_id));

  // Telegram links for all users
  const { data: tgAll } = await sb
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .not("chat_id", "is", null);
  const chatById = new Map<string, number>(
    (tgAll ?? []).filter((r: any) => r.chat_id).map((r: any) => [r.user_id, Number(r.chat_id)])
  );

  // All user profiles (for names)
  const allUserIds = Array.from(chatById.keys()).filter(id => !sentSet.has(id));
  if (allUserIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "all sent today" }));
  }

  const { data: profiles } = await sb
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", allUserIds);
  const nameById = new Map<string, string>(
    (profiles ?? []).map((p: any) => [
      p.id,
      `${p.first_name ?? ""}`.trim() || "там",
    ])
  );

  // Roles
  const { data: roles } = await sb
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", allUserIds);
  const rolesByUser = new Map<string, Set<string>>();
  for (const r of roles ?? []) {
    if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, new Set());
    rolesByUser.get(r.user_id)!.add(r.role);
  }

  // Tutor settings (digest opt-IN). The agreed default cadence is WEEKLY, so the daily
  // digest must be strictly opt-in: only tutors who explicitly set daily_digest_enabled
  // = true receive it. (Previously `!== false` defaulted every tutor to daily, which is
  // why hub tutors were getting daily notifications they never asked for.)
  const { data: tutorSettings } = await sb
    .from("tutor_workspace_settings")
    .select("tutor_id, daily_digest_enabled")
    .in("tutor_id", allUserIds);
  const digestEnabled = new Map<string, boolean>(
    (tutorSettings ?? []).map((s: any) => [s.tutor_id, s.daily_digest_enabled === true])
  );

  // Today's lessons — all
  const { data: todayLessons } = await sb
    .from("lessons")
    .select("id, tutor_id, student_id, starts_at, subject, source, lesson_details(student_price, student_payment_status)")
    .in("status", ["scheduled", "completed"])
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at", { ascending: true });

  // ЄДИНЕ визначення боргів = src/lib/financials.ts (isStudentDebtLesson /
  // isPayoutDueLesson). Дайджест ДЗЕРКАЛИТЬ його дослівно — розбіжність цифр
  // телеграм↔застосунок була саме тут (дайджест брав лише completed).
  const { data: moneyRaw } = await sb
    .from("lessons")
    .select("id, tutor_id, student_id, source, status, starts_at, group_id, lesson_details(student_price, student_payment_status, tutor_payout, tutor_payout_status, is_cancellation_fee)")
    .in("status", ["completed", "scheduled", "cancelled"]);
  const BUILD_TAG = "v25.08-uxstep27";
  const nowMs = Date.now();
  const isStudentDebt = (l: any) => {
    const d = l.lesson_details ?? {};
    if ((d.student_payment_status ?? "unpaid") !== "unpaid") return false;
    if (Number(d.student_price ?? 0) <= 0) return false;
    if (l.status === "cancelled") return d.is_cancellation_fee === true;
    if (l.group_id) return false; // групові білються поза parent-рядком (v2: participants)
    return true; // completed АБО майбутній scheduled — передоплатна модель
  };
  const isPayoutDue = (l: any) => {
    const d = l.lesson_details ?? {};
    if (l.group_id) return false;
    if (d.tutor_payout_status === "paid") return false;
    if (Number(d.tutor_payout ?? 0) <= 0) return false;
    if (l.status === "cancelled") return false;
    return l.status === "completed" || new Date(l.starts_at).getTime() <= nowMs;
  };
  const unpaidLessons = (moneyRaw ?? []).filter(isStudentDebt);
  const payoutDueLessons = (moneyRaw ?? []).filter(isPayoutDue);

  // ГРУПОВІ борги — по УЧАСНИКАХ (parent completed|scheduled, учасник unpaid&price>0).
  const { data: groupRaw } = await sb
    .from("lessons")
    .select("id, tutor_id, source, status, lesson_participants(student_id, student_price, student_payment_status)")
    .not("group_id", "is", null)
    .in("status", ["completed", "scheduled"]);
  const groupDebtRows = (groupRaw ?? []).flatMap((l: any) =>
    (l.lesson_participants ?? [])
      .filter((p: any) => (p.student_payment_status ?? "unpaid") === "unpaid" && Number(p.student_price ?? 0) > 0)
      .map((p: any) => ({ tutor_id: l.tutor_id, source: l.source, student_id: p.student_id, price: Number(p.student_price) }))
  );

  // Технічні помилки за добу — власниця дізнається з ранкового дайджеста,
  // а не з випадкового заходу на /errors.
  const { count: errCount } = await sb
    .from("error_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  // Менеджерські тотали — з ЄДИНОГО джерела правди (та сама функція, що й
  // самозвірка в застосунку): рахує індивідуальні + групові + виплати.
  const { data: summaryRows } = await sb.rpc("manager_debts_summary" as any);
  const summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;

  // Student names
  const studentIds = Array.from(new Set([
    ...(todayLessons ?? []).map((l: any) => l.student_id),
    ...(unpaidLessons ?? []).map((l: any) => l.student_id),
    ...groupDebtRows.map((r: any) => r.student_id),
  ]));
  const { data: students } = studentIds.length
    ? await sb.from("profiles").select("id, first_name, last_name").in("id", studentIds)
    : { data: [] };
  const studentName = new Map<string, string>(
    (students ?? []).map((p: any) => [
      p.id,
      `${(p.first_name ?? "")} ${(p.last_name ?? "")}`.trim() || "Учень",
    ])
  );

  let sent = 0;

  for (const userId of allUserIds) {
    const chatId = chatById.get(userId);
    if (!chatId) continue;

    const userRoles = rolesByUser.get(userId) ?? new Set();
    const isManager = userRoles.has("manager");
    const isTutor = userRoles.has("tutor");

    // Skip tutors who opted out
    if (isTutor && !isManager && digestEnabled.get(userId) === false) continue;

    const firstName = nameById.get(userId) ?? "";
    const lines: string[] = [greet(firstName)];

    if (isManager) {
      // Manager: see ALL center lessons (source != independent)
      const myLessons = (todayLessons ?? []).filter((l: any) => l.source !== "independent");
      if (myLessons.length === 0) {
        lines.push("\nСьогодні в центрі занять немає — гарний день для планування чи відпочинку 🌿");
      } else {
        lines.push(`\n📅 Сьогодні в центрі <b>${myLessons.length} ${lessonWord(myLessons.length)}</b>:`);
        for (const l of myLessons.slice(0, 10)) {
          const t = new Date(l.starts_at).toLocaleTimeString("uk-UA", {
            timeZone: TZ, hour: "2-digit", minute: "2-digit",
          });
          lines.push(`• ${t} — ${esc(studentName.get(l.student_id))} (${esc(l.subject)})`);
        }
        if (myLessons.length > 10) lines.push(`  ↳ ще ${myLessons.length - 10} уроків`);
      }
      const sd = Number(summary?.students_debt ?? 0);
      const po = Number(summary?.payouts_owed ?? 0);
      if (sd > 0) lines.push(`\n💳 Борг учнів: <b>${sd} ₴</b>`);
      if (po > 0) lines.push(`👛 До виплати репетиторам: <b>${po} ₴</b>`);
      if ((errCount ?? 0) > 0) lines.push(`🛠 Технічні помилки за добу: <b>${errCount}</b> — сторінка /errors`);
    } else if (isTutor) {
      // Tutor: their own lessons
      const myLessons = (todayLessons ?? []).filter((l: any) => l.tutor_id === userId);
      if (myLessons.length === 0) {
        lines.push("\nСьогодні вільний день — балдій, заряджайся! 🌴");
      } else {
        lines.push(`\n📅 Сьогодні <b>${myLessons.length} ${lessonWord(myLessons.length)}</b>:`);
        for (const l of myLessons) {
          const t = new Date(l.starts_at).toLocaleTimeString("uk-UA", {
            timeZone: TZ, hour: "2-digit", minute: "2-digit",
          });
          const paid = l.lesson_details?.student_payment_status === "paid" ? " ✅" : "";
          lines.push(`• ${t} — ${esc(studentName.get(l.student_id))} (${esc(l.subject)})${paid}`);
        }
      }
      const myDebts = new Map<string, number>();
      for (const l of (unpaidLessons ?? []).filter((l: any) => l.tutor_id === userId)) {
        const prev = myDebts.get(l.student_id) ?? 0;
        myDebts.set(l.student_id, prev + Number(l.lesson_details?.student_price ?? 0));
      }
      for (const r of groupDebtRows.filter((r: any) => r.tutor_id === userId)) {
        myDebts.set(r.student_id, (myDebts.get(r.student_id) ?? 0) + r.price);
      }
      if (myDebts.size > 0) {
        const total = Array.from(myDebts.values()).reduce((a, b) => a + b, 0);
        lines.push(`\n💳 Нагадай учням про оплату — загалом <b>${total} ₴</b>:`);
        for (const [sid, amount] of Array.from(myDebts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
          lines.push(`• ${esc(studentName.get(sid))} — ${amount} ₴`);
        }
        if (myDebts.size > 5) lines.push(`  ↳ ще ${myDebts.size - 5} учнів`);
      } else {
        lines.push("\n✅ Всі оплати закриті — так тримати! 🎉");
      }
    } else {
      continue; // Student — не відправляємо
    }

      lines.push(`\n<i>v ${BUILD_TAG}</i>`);
    const ok = await sendTg(BOT, chatId, lines.join("\n"));
    if (ok) {
      await sb.from("tutor_daily_digests").insert({
        tutor_id: userId, digest_date: today, channel: "telegram",
      });
      sent++;
    }
  }

  return new Response(JSON.stringify({ ok: true, date: today, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
