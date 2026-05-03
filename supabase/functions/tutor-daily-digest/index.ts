// Sends a morning digest to each tutor's Telegram with today's lessons and
// outstanding student debts. Idempotent per (tutor, date) via tutor_daily_digests.
// Designed to be invoked on a cron at the desired morning hour (Europe/Kyiv).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "Europe/Kyiv";

function todayDateInKyiv(): string {
  // YYYY-MM-DD in Europe/Kyiv timezone
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function dayBoundsKyiv(dateStr: string): { fromIso: string; toIso: string } {
  // Kyiv is UTC+2 (winter) or UTC+3 (summer). Use Date in local TZ via Intl.
  // Build explicit "00:00" and "23:59:59" in Kyiv, then convert to UTC ISO.
  const [y, m, d] = dateStr.split("-").map(Number);
  // Approximate offset by formatting the same instant in Kyiv vs UTC
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const kyivHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      hour12: false,
    }).format(probe),
  );
  const offsetHours = kyivHour - 12; // 2 or 3
  const fromIso = new Date(
    Date.UTC(y, m - 1, d, 0 - offsetHours, 0, 0),
  ).toISOString();
  const toIso = new Date(
    Date.UTC(y, m - 1, d, 24 - offsetHours, 0, 0),
  ).toISOString();
  return { fromIso, toIso };
}

async function sendTg(
  botToken: string,
  chatId: number,
  text: string,
): Promise<boolean> {
  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );
  return resp.ok;
}

Deno.serve(async (req) => {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  // Restrict invocation to cron / service-role callers only.
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret");
  if (!provided || provided !== serviceKey) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  // Auth: function deploys with verify_jwt = true by default, so any caller
  // must already present a valid Supabase JWT (anon or service role). The
  // function itself only reads service-role-only data via the service client.

  const supabase = createClient(supabaseUrl, serviceKey);
  const today = todayDateInKyiv();
  const { fromIso, toIso } = dayBoundsKyiv(today);

  // 1. Tutors that opted in to digests
  const { data: settingsRows, error: sErr } = await supabase
    .from("tutor_workspace_settings")
    .select("tutor_id, daily_digest_enabled")
    .eq("daily_digest_enabled", true);
  if (sErr) {
    return new Response(JSON.stringify({ error: sErr.message }), { status: 500 });
  }
  const tutorIds = (settingsRows ?? []).map((r: any) => r.tutor_id);
  if (tutorIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no opted-in tutors" }));
  }

  // 2. Skip tutors that already received today's digest
  const { data: alreadySent } = await supabase
    .from("tutor_daily_digests")
    .select("tutor_id")
    .eq("digest_date", today)
    .in("tutor_id", tutorIds);
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.tutor_id));
  const targets = tutorIds.filter((id) => !sentSet.has(id));
  if (targets.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "all already sent today" }));
  }

  // 3. Telegram chats for those tutors
  const { data: tgLinks } = await supabase
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .in("user_id", targets)
    .not("chat_id", "is", null);
  const chatByTutor = new Map<string, number>();
  for (const link of tgLinks ?? []) {
    if (link.chat_id) chatByTutor.set(link.user_id, Number(link.chat_id));
  }

  // 4. Today's lessons + outstanding debts (all in one query each)
  const [{ data: todaysLessons }, { data: unpaidLessons }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, tutor_id, student_id, starts_at, subject, status, student_payment_status, student_price")
      .in("tutor_id", targets)
      .in("status", ["scheduled", "completed"])
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso)
      .order("starts_at", { ascending: true }),
    supabase
      .from("lessons")
      .select("id, tutor_id, student_id, student_price")
      .in("tutor_id", targets)
      .eq("status", "completed")
      .eq("student_payment_status", "unpaid")
      .gt("student_price", 0),
  ]);

  // 5. Resolve student names
  const studentIds = Array.from(
    new Set([
      ...((todaysLessons ?? []).map((l: any) => l.student_id)),
      ...((unpaidLessons ?? []).map((l: any) => l.student_id)),
    ]),
  );
  const nameById = new Map<string, string>();
  if (studentIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", studentIds);
    for (const p of profs ?? []) {
      nameById.set(
        p.id,
        `${(p.first_name ?? "").trim()} ${(p.last_name ?? "").trim()}`.trim() ||
          "Учень",
      );
    }
  }

  // 6. Group per tutor and send
  const lessonsByTutor = new Map<string, any[]>();
  for (const l of todaysLessons ?? []) {
    const arr = lessonsByTutor.get(l.tutor_id) ?? [];
    arr.push(l);
    lessonsByTutor.set(l.tutor_id, arr);
  }
  const debtsByTutor = new Map<string, Map<string, { count: number; total: number }>>();
  for (const l of unpaidLessons ?? []) {
    const map = debtsByTutor.get(l.tutor_id) ?? new Map();
    const cur = map.get(l.student_id) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(l.student_price ?? 0);
    map.set(l.student_id, cur);
    debtsByTutor.set(l.tutor_id, map);
  }

  let sent = 0;
  let skipped = 0;

  for (const tutorId of targets) {
    const chatId = chatByTutor.get(tutorId);
    if (!chatId) {
      skipped++;
      continue;
    }
    const lessons = lessonsByTutor.get(tutorId) ?? [];
    const debts = debtsByTutor.get(tutorId) ?? new Map();

    // Skip if absolutely nothing to say
    if (lessons.length === 0 && debts.size === 0) {
      skipped++;
      // Still record so we don't retry repeatedly today
      await supabase
        .from("tutor_daily_digests")
        .insert({ tutor_id: tutorId, digest_date: today, channel: "telegram" });
      continue;
    }

    // Compose message
    const lines: string[] = [];
    lines.push("☀️ <b>Доброго ранку!</b>");
    if (lessons.length === 0) {
      lines.push("\nСьогодні уроків не заплановано.");
    } else {
      lines.push(`\n📅 Сьогодні <b>${lessons.length}</b> урок${
        lessons.length === 1 ? "" : lessons.length < 5 ? "и" : "ів"
      }:`);
      for (const l of lessons) {
        const t = new Date(l.starts_at).toLocaleTimeString("uk-UA", {
          timeZone: TZ,
          hour: "2-digit",
          minute: "2-digit",
        });
        const name = nameById.get(l.student_id) ?? "Учень";
        const paid = l.student_payment_status === "paid" ? " ✅" : "";
        lines.push(`• ${t} — ${name} (${l.subject})${paid}`);
      }
    }

    if (debts.size > 0) {
      let totalDebt = 0;
      for (const v of debts.values()) totalDebt += v.total;
      lines.push(
        `\n💳 <b>Очікують оплати:</b> ${debts.size} учн${
          debts.size === 1 ? "ів" : debts.size < 5 ? "ів" : "ів"
        } · ${totalDebt} ₴`,
      );
      const debtList = Array.from(debts.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 8);
      for (const [studentId, v] of debtList) {
        const name = nameById.get(studentId) ?? "Учень";
        lines.push(`• ${name} — ${v.total} ₴ (${v.count} ур.)`);
      }
    }

    const ok = await sendTg(TELEGRAM_BOT_TOKEN, chatId, lines.join("\n"));
    if (!ok) {
      skipped++;
      continue;
    }
    await supabase
      .from("tutor_daily_digests")
      .insert({ tutor_id: tutorId, digest_date: today, channel: "telegram" });
    sent++;
  }

  return new Response(
    JSON.stringify({ ok: true, date: today, eligible: targets.length, sent, skipped }),
    { headers: { "Content-Type": "application/json" } },
  );
});
