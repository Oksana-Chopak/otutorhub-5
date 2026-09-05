type DLang = "uk" | "en" | "sv";
const dlang = (v: unknown): DLang => (v === "en" || v === "sv" ? v : "uk");

// Тексти дайджесту — мовою репетитора (profiles.preferred_language), за тим
// самим патерном, що payment-reminders (RT) і tutor-evening-summary.
const DT = {
  uk: {
    hi: (n: string, h: number) => `${h < 12 ? "🌤️" : h < 17 ? "☀️" : "🌙"} Привіт, ${n}!`,
    fallbackName: "там",
    lessons: (n: number) => (n === 1 ? "урок" : n >= 2 && n <= 4 ? "уроки" : "уроків"),
    mgrNone: "\nСьогодні в центрі занять немає — гарний день для планування чи відпочинку 🌿",
    mgrToday: (n: number, w: string) => `\n📅 Сьогодні в центрі <b>${n} ${w}</b>:`,
    more: (n: number) => `  ↳ ще ${n} уроків`,
    debt: (s: string) => `\n💳 Борг учнів: <b>${s}</b>`,
    payout: (s: string) => `👛 До виплати репетиторам: <b>${s}</b>`,
    errors: (n: number) => `🛠 Технічні помилки за добу: <b>${n}</b> — сторінка /errors`,
    tutNone: "\nСьогодні вільний день — балдій, заряджайся! 🌴",
    tutToday: (n: number, w: string) => `\n📅 Сьогодні <b>${n} ${w}</b>:`,
    remind: (s: string) => `\n💳 Нагадай учням про оплату — загалом <b>${s}</b>:`,
    moreStudents: (n: number) => `  ↳ ще ${n} учнів`,
    allPaid: "\n✅ Всі оплати закриті — так тримати! 🎉",
    btnRemind: (nm: string) => `🔔 Нагадати: ${nm}`,
    btnPaid: (nm: string) => `✅ ${nm} оплатив(ла)`,
    btnName: "учень",
  },
  en: {
    hi: (n: string, h: number) => `${h < 12 ? "🌤️" : h < 17 ? "☀️" : "🌙"} Hi, ${n}!`,
    fallbackName: "there",
    lessons: (n: number) => (n === 1 ? "lesson" : "lessons"),
    mgrNone: "\nNo lessons at the centre today — a good day to plan or rest 🌿",
    mgrToday: (n: number, w: string) => `\n📅 Today at the centre: <b>${n} ${w}</b>:`,
    more: (n: number) => `  ↳ ${n} more`,
    debt: (s: string) => `\n💳 Students' debt: <b>${s}</b>`,
    payout: (s: string) => `👛 Due to tutors: <b>${s}</b>`,
    errors: (n: number) => `🛠 Technical errors in 24 h: <b>${n}</b> — see /errors`,
    tutNone: "\nA free day today — recharge! 🌴",
    tutToday: (n: number, w: string) => `\n📅 Today: <b>${n} ${w}</b>:`,
    remind: (s: string) => `\n💳 Remind students to pay — total <b>${s}</b>:`,
    moreStudents: (n: number) => `  ↳ ${n} more students`,
    allPaid: "\n✅ All payments settled — keep it up! 🎉",
    btnRemind: (nm: string) => `🔔 Remind: ${nm}`,
    btnPaid: (nm: string) => `✅ ${nm} paid`,
    btnName: "student",
  },
  sv: {
    hi: (n: string, h: number) => `${h < 12 ? "🌤️" : h < 17 ? "☀️" : "🌙"} Hej, ${n}!`,
    fallbackName: "du",
    lessons: (n: number) => (n === 1 ? "lektion" : "lektioner"),
    mgrNone: "\nInga lektioner på centret idag — en bra dag att planera eller vila 🌿",
    mgrToday: (n: number, w: string) => `\n📅 Idag på centret: <b>${n} ${w}</b>:`,
    more: (n: number) => `  ↳ ${n} till`,
    debt: (s: string) => `\n💳 Elevernas skuld: <b>${s}</b>`,
    payout: (s: string) => `👛 Att betala lärare: <b>${s}</b>`,
    errors: (n: number) => `🛠 Tekniska fel senaste dygnet: <b>${n}</b> — se /errors`,
    tutNone: "\nLedig dag idag — ladda batterierna! 🌴",
    tutToday: (n: number, w: string) => `\n📅 Idag: <b>${n} ${w}</b>:`,
    remind: (s: string) => `\n💳 Påminn elever om betalning — totalt <b>${s}</b>:`,
    moreStudents: (n: number) => `  ↳ ${n} elever till`,
    allPaid: "\n✅ Alla betalningar klara — bra jobbat! 🎉",
    btnRemind: (nm: string) => `🔔 Påminn: ${nm}`,
    btnPaid: (nm: string) => `✅ ${nm} betalade`,
    btnName: "elev",
  },
} as const;

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

type TgButton = { text: string; callback_data: string };

async function sendTg(token: string, chatId: number, text: string, keyboard?: TgButton[][]): Promise<boolean> {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(keyboard && keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) }),
  });
  return r.ok;
}

/** Ім'я на кнопці: перше слово, не довше 14 символів. */
function shortName(full: unknown, fallback: string): string {
  const first = String(full ?? "").trim().split(/\s+/)[0] || fallback;
  return first.length > 14 ? first.slice(0, 13) + "…" : first;
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
    .select("id, first_name, last_name, preferred_language")
    .in("id", allUserIds);
  const nameById = new Map<string, string>(
    (profiles ?? []).map((p: any) => [p.id, `${p.first_name ?? ""}`.trim()])
  );
  const langById = new Map<string, DLang>(
    (profiles ?? []).map((p: any) => [p.id, dlang(p.preferred_language)])
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
  const BUILD_TAG = "v25.09-uxstep50";
  const nowMs = Date.now();
  const detailOf = (l: any) => {
    const d = l.lesson_details;
    return Array.isArray(d) ? d[0] : d;
  };
  const isStudentDebt = (l: any) => {
    const d = detailOf(l) ?? {};
    if ((d.student_payment_status ?? "unpaid") !== "unpaid") return false;
    if (Number(d.student_price ?? 0) <= 0) return false;
    if (l.status === "cancelled") return d.is_cancellation_fee === true;
    if (l.group_id) return false; // групові білються поза parent-рядком (v2: participants)
    // Модель 04.09 (аудит 05.09 знайшов розбіжність): борг = ПРОВЕДЕНЕ й
    // неоплачене — дзеркало isStudentDebtLesson/financials.ts. Інакше цифра
    // в Telegram не сходилась із «Фінансами», куди веде цей же дайджест.
    return l.status === "completed";
  };
  const isPayoutDue = (l: any) => {
    const d = detailOf(l) ?? {};
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
      `${(p.first_name ?? "")} ${(p.last_name ?? "")}`.trim() || "—", // мова невідома на цьому рівні
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

    const D = DT[langById.get(userId) ?? "uk"];
    const kyivHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }).format(new Date()));
    const firstName = nameById.get(userId) || D.fallbackName;
    const keyboard: TgButton[][] = [];
    const lines: string[] = [D.hi(esc(firstName), kyivHour)];

    if (isManager) {
      // Manager: see ALL center lessons (source != independent)
      const myLessons = (todayLessons ?? []).filter((l: any) => l.source !== "independent");
      if (myLessons.length === 0) {
        lines.push(D.mgrNone);
      } else {
        lines.push(D.mgrToday(myLessons.length, D.lessons(myLessons.length)));
        for (const l of myLessons.slice(0, 10)) {
          const t = new Date(l.starts_at).toLocaleTimeString("uk-UA", {
            timeZone: TZ, hour: "2-digit", minute: "2-digit",
          });
          lines.push(`• ${t} — ${esc(studentName.get(l.student_id))} (${esc(l.subject)})`);
        }
        if (myLessons.length > 10) lines.push(D.more(myLessons.length - 10));
      }
      const sd = Number(summary?.students_debt ?? 0);
      const po = Number(summary?.payouts_owed ?? 0);
      if (sd > 0) lines.push(D.debt(`${sd} ₴`));
      if (po > 0) lines.push(D.payout(`${po} ₴`));
      if ((errCount ?? 0) > 0) lines.push(D.errors(Number(errCount)));
    } else if (isTutor) {
      // Tutor: their own lessons
      const myLessons = (todayLessons ?? []).filter((l: any) => l.tutor_id === userId);
      if (myLessons.length === 0) {
        lines.push(D.tutNone);
      } else {
        lines.push(D.tutToday(myLessons.length, D.lessons(myLessons.length)));
        for (const l of myLessons) {
          const t = new Date(l.starts_at).toLocaleTimeString("uk-UA", {
            timeZone: TZ, hour: "2-digit", minute: "2-digit",
          });
          const paid = detailOf(l)?.student_payment_status === "paid" ? " ✅" : "";
          lines.push(`• ${t} — ${esc(studentName.get(l.student_id))} (${esc(l.subject)})${paid}`);
        }
      }
      const myDebts = new Map<string, number>();
      // Кнопки «Оплачено» законні лише там, де репетитор САМ тоглить оплату —
      // тобто на незалежних уроках. Хабовий борг закриває менеджер.
      const debtIndependent = new Map<string, boolean>();
      const noteDebt = (sid: string, amount: number, source: string) => {
        myDebts.set(sid, (myDebts.get(sid) ?? 0) + amount);
        debtIndependent.set(sid, (debtIndependent.get(sid) ?? true) && source === "independent");
      };
      for (const l of (unpaidLessons ?? []).filter((l: any) => l.tutor_id === userId)) {
        noteDebt(l.student_id, Number(detailOf(l)?.student_price ?? 0), l.source);
      }
      for (const r of groupDebtRows.filter((r: any) => r.tutor_id === userId)) {
        noteDebt(r.student_id, r.price, r.source);
      }
      if (myDebts.size > 0) {
        const total = Array.from(myDebts.values()).reduce((a, b) => a + b, 0);
        lines.push(D.remind(`${total} ₴`));
        for (const [sid, amount] of Array.from(myDebts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
          lines.push(`• ${esc(studentName.get(sid))} — ${amount} ₴`);
          // Кнопки прямо в Telegram: «Нагадати» шле учневі TG + сповіщення в
          // застосунку; «Оплачено» закриває ВСІ борги цієї пари. Обробляє
          // telegram-poll (callback_query); автор дії = власник chat_id.
          if (debtIndependent.get(sid)) {
            const nm = shortName(studentName.get(sid), D.btnName);
            keyboard.push([
              { text: D.btnRemind(nm), callback_data: `rem:${sid}` },
              { text: D.btnPaid(nm), callback_data: `paid:${sid}` },
            ]);
          }
        }
        if (myDebts.size > 5) lines.push(D.moreStudents(myDebts.size - 5));
      } else {
        lines.push(D.allPaid);
      }
    } else {
      continue; // Student — не відправляємо
    }

      lines.push(`\n<i>v ${BUILD_TAG}</i>`);
    const ok = await sendTg(BOT, chatId, lines.join("\n"), keyboard);
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
