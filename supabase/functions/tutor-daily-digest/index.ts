type DLang = "uk" | "en" | "sv";
const dlang = (v: unknown): DLang => (v === "en" || v === "sv" ? v : "uk");

// Тексти дайджесту — мовою репетитора (profiles.preferred_language), за тим
// самим патерном, що payment-reminders (RT) і tutor-evening-summary.
const DT = {
  uk: {
    hi: (n: string, h: number) => `${h < 12 ? "🌤️" : h < 17 ? "☀️" : "🌙"} Привіт, ${n}!`,
    fallbackName: "там",
    lessons: (n: number) => (n === 1 ? "урок" : n >= 2 && n <= 4 ? "уроки" : "уроків"),
    mgrNone: "\nСьогодні у школі занять немає — гарний день для планування чи відпочинку 🌿",
    mgrToday: (n: number, w: string) => `\n📅 Сьогодні у школі <b>${n} ${w}</b>:`,
    more: (n: number) => `  ↳ ще ${n} уроків`,
    debt: (s: string) => `\n💳 Борг учнів: <b>${s}</b>`,
    owe: (s: string) => `\n👛 Ви винні репетиторам: <b>${s}</b>`,
    oweLine: (nm: string, s: string, n: number, w: string) => `• ${nm} — ${s} (${n} ${w})`,
    payoutToday: " · ⏰ сьогодні день виплати",
    moreTutors: (n: number) => `  ↳ ще ${n} репетиторів`,
    noRate: (nm: string, n: number, w: string) => `⚠️ ${nm} — ${n} ${w} без суми виплати. Натисніть «⚙️ Ставка» нижче й впишіть ставку — сума підтягнеться сама.`,
    btnPayoutPaid: (nm: string) => `👛 Виплатив(ла): ${nm}`,
    btnRate: (nm: string) => `⚙️ Ставка: ${nm}`,
    btnTutorName: "репетитор",
    errors: (n: number) => `🛠 Технічні помилки за добу: <b>${n}</b> — сторінка /errors`,
    jobsTitle: "🛡 Нічні процеси за добу:",
    jobName: (job: string) => ({
      "tutor-evening-summary": "вечірній підсумок", "payment-reminders": "нагадування про оплату",
      "lesson-reminders": "нагадування про уроки", "db-backup": "резервна копія", "telegram-poll": "телеграм-бот",
      "scheduled-notifications": "планові сповіщення", "tutor-weekly-digest": "тижневий дайджест",
      "payout-reminders": "нагадування про виплати", "process-email-queue": "черга пошти",
      "fireflies-auto-join": "запис уроків", "archive-old-chats": "архів чатів", "tutor-daily-digest": "ранковий дайджест",
    } as Record<string, string>)[job] ?? job,
    jobMissing: "не запускався понад добу",
    jobFailed: (n: number) => `збоїв: ${n}`,
    jobsUnknown: `🛡 Нічні процеси: зведення прочитати не вдалося (SQL 20260927170000 ще не вставлено?)`,
    importLoop: (lists: number, rows: number, top: string) => `👀 Імпорт за 7 днів: <b>${lists}</b> списків із невпізнаними рядками (${rows} рядків). Найчастіше: ${top}`,
    tutNone: "\nСьогодні вільний день — балдій, заряджайся! 🌴",
    tutToday: (n: number, w: string) => `\n📅 Сьогодні <b>${n} ${w}</b>:`,
    remind: (s: string) => `\n💳 Нагадай учням про оплату — загалом <b>${s}</b>:`,
    moreStudents: (n: number) => `  ↳ ще ${n} учнів`,
    allPaid: "\n✅ Всі оплати закриті — так тримати! 🎉",
    todayUnavailable: "\n⚠️ Розклад на сьогодні зараз не вдалося прочитати — він є в застосунку.",
    moneyUnavailable: "\n⚠️ Оплати зараз не вдалося перевірити — актуальні цифри у «Фінансах» застосунку.",
    btnRemind: (nm: string) => `🔔 Нагадати: ${nm}`,
    btnPaid: (nm: string) => `✅ ${nm} оплатив(ла)`,
    btnName: "учень",
    btnPrepay: "💳 Позначити передоплату від учня",
    mgrDebtors: "\n👥 Хто винен:",
  },
  en: {
    hi: (n: string, h: number) => `${h < 12 ? "🌤️" : h < 17 ? "☀️" : "🌙"} Hi, ${n}!`,
    fallbackName: "there",
    lessons: (n: number) => (n === 1 ? "lesson" : "lessons"),
    mgrNone: "\nNo lessons at the school today — a good day to plan or rest 🌿",
    mgrToday: (n: number, w: string) => `\n📅 Today at the school: <b>${n} ${w}</b>:`,
    more: (n: number) => `  ↳ ${n} more`,
    debt: (s: string) => `\n💳 Students' debt: <b>${s}</b>`,
    owe: (s: string) => `\n👛 You owe your tutors: <b>${s}</b>`,
    oweLine: (nm: string, s: string, n: number, w: string) => `• ${nm} — ${s} (${n} ${w})`,
    payoutToday: " · ⏰ payout day is today",
    moreTutors: (n: number) => `  ↳ ${n} more tutors`,
    noRate: (nm: string, n: number, w: string) => `⚠️ ${nm} — ${n} ${w} without a payout amount. Tap “⚙️ Rate” below and enter the rate — the amount fills in by itself.`,
    btnPayoutPaid: (nm: string) => `👛 Paid out: ${nm}`,
    btnRate: (nm: string) => `⚙️ Rate: ${nm}`,
    btnTutorName: "tutor",
    errors: (n: number) => `🛠 Technical errors in 24 h: <b>${n}</b> — see /errors`,
    jobsTitle: "🛡 Background jobs in 24 h:",
    jobName: (job: string) => ({
      "tutor-evening-summary": "evening summary", "payment-reminders": "payment reminders",
      "lesson-reminders": "lesson reminders", "db-backup": "backup", "telegram-poll": "Telegram bot",
      "scheduled-notifications": "scheduled notifications", "tutor-weekly-digest": "weekly digest",
      "payout-reminders": "payout reminders", "process-email-queue": "email queue",
      "fireflies-auto-join": "lesson recording", "archive-old-chats": "chat archive", "tutor-daily-digest": "morning digest",
    } as Record<string, string>)[job] ?? job,
    jobMissing: "did not run for over a day",
    jobFailed: (n: number) => `failed: ${n}`,
    jobsUnknown: `🛡 Background jobs: could not read the summary (SQL 20260927170000 not applied yet?)`,
    importLoop: (lists: number, rows: number, top: string) => `👀 Imports in 7 days: <b>${lists}</b> lists with unrecognised lines (${rows} lines). Most common: ${top}`,
    tutNone: "\nA free day today — recharge! 🌴",
    tutToday: (n: number, w: string) => `\n📅 Today: <b>${n} ${w}</b>:`,
    remind: (s: string) => `\n💳 Remind students to pay — total <b>${s}</b>:`,
    moreStudents: (n: number) => `  ↳ ${n} more students`,
    allPaid: "\n✅ All payments settled — keep it up! 🎉",
    todayUnavailable: "\n⚠️ Couldn’t read today’s schedule right now — it’s in the app.",
    moneyUnavailable: "\n⚠️ Couldn’t check payments right now — the current figures are in Finances in the app.",
    btnRemind: (nm: string) => `🔔 Remind: ${nm}`,
    btnPaid: (nm: string) => `✅ ${nm} paid`,
    btnName: "student",
    btnPrepay: "💳 Record a student prepayment",
    mgrDebtors: "\n👥 Who owes:",
  },
  sv: {
    hi: (n: string, h: number) => `${h < 12 ? "🌤️" : h < 17 ? "☀️" : "🌙"} Hej, ${n}!`,
    fallbackName: "du",
    lessons: (n: number) => (n === 1 ? "lektion" : "lektioner"),
    mgrNone: "\nInga lektioner i skolan idag — en bra dag att planera eller vila 🌿",
    mgrToday: (n: number, w: string) => `\n📅 Idag i skolan: <b>${n} ${w}</b>:`,
    more: (n: number) => `  ↳ ${n} till`,
    debt: (s: string) => `\n💳 Elevernas skuld: <b>${s}</b>`,
    owe: (s: string) => `\n👛 Du är skyldig dina lärare: <b>${s}</b>`,
    oweLine: (nm: string, s: string, n: number, w: string) => `• ${nm} — ${s} (${n} ${w})`,
    payoutToday: " · ⏰ utbetalningsdag idag",
    moreTutors: (n: number) => `  ↳ ${n} lärare till`,
    noRate: (nm: string, n: number, w: string) => `⚠️ ${nm} — ${n} ${w} utan utbetalningsbelopp. Tryck på ”⚙️ Sats” nedan och ange satsen — beloppet fylls i av sig självt.`,
    btnPayoutPaid: (nm: string) => `👛 Utbetalt: ${nm}`,
    btnRate: (nm: string) => `⚙️ Sats: ${nm}`,
    btnTutorName: "lärare",
    errors: (n: number) => `🛠 Tekniska fel senaste dygnet: <b>${n}</b> — se /errors`,
    jobsTitle: "🛡 Bakgrundsjobb senaste dygnet:",
    jobName: (job: string) => ({
      "tutor-evening-summary": "kvällssammanfattning", "payment-reminders": "betalningspåminnelser",
      "lesson-reminders": "lektionspåminnelser", "db-backup": "säkerhetskopia", "telegram-poll": "Telegram-bot",
      "scheduled-notifications": "schemalagda aviseringar", "tutor-weekly-digest": "veckosammanfattning",
      "payout-reminders": "utbetalningspåminnelser", "process-email-queue": "e-postkö",
      "fireflies-auto-join": "lektionsinspelning", "archive-old-chats": "chattarkiv", "tutor-daily-digest": "morgonsammanfattning",
    } as Record<string, string>)[job] ?? job,
    jobMissing: "kördes inte på över ett dygn",
    jobFailed: (n: number) => `misslyckade: ${n}`,
    jobsUnknown: `🛡 Bakgrundsjobb: kunde inte läsa sammanfattningen (SQL 20260927170000 inte inlagd än?)`,
    importLoop: (lists: number, rows: number, top: string) => `👀 Importer på 7 dagar: <b>${lists}</b> listor med oigenkända rader (${rows} rader). Vanligast: ${top}`,
    tutNone: "\nLedig dag idag — ladda batterierna! 🌴",
    tutToday: (n: number, w: string) => `\n📅 Idag: <b>${n} ${w}</b>:`,
    remind: (s: string) => `\n💳 Påminn elever om betalning — totalt <b>${s}</b>:`,
    moreStudents: (n: number) => `  ↳ ${n} elever till`,
    allPaid: "\n✅ Alla betalningar klara — bra jobbat! 🎉",
    todayUnavailable: "\n⚠️ Kunde inte läsa dagens schema just nu — det finns i appen.",
    moneyUnavailable: "\n⚠️ Kunde inte kontrollera betalningar just nu — aktuella siffror finns under Ekonomi i appen.",
    btnRemind: (nm: string) => `🔔 Påminn: ${nm}`,
    btnPaid: (nm: string) => `✅ ${nm} betalade`,
    btnName: "elev",
    btnPrepay: "💳 Registrera förskott från elev",
    mgrDebtors: "\n👥 Vem är skyldig:",
  },
} as const;

// Daily morning digest — all roles: independent tutors, hired tutors, managers.
// Idempotent per (user_id, digest_date) via tutor_daily_digests.
// Invoked by pg_cron at 06:00 UTC (08:00 EET / 09:00 EEST).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPayoutDueToday, kyivNow } from "../_shared/payoutSchedule.ts";
import { fetchAllRows } from "../_shared/fetchAll.ts";
import { versionProbe } from "../_shared/build.ts";
import { withJob } from "../_shared/jobRun.ts";

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

// Кнопка або з callback (обробляє telegram-poll), або з url (відкриває застосунок).
type TgButton = { text: string; callback_data?: string; url?: string };
const APP_URL = "https://otutorhub.com";
/** Deep-link у форму «Записати оплату» одразу на вкладці «Передоплата». */
const PREPAY_URL = `${APP_URL}/finances?record=1&tab=prepay`;

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

Deno.serve(withJob("tutor-daily-digest", async (req) => {
  const probe = versionProbe(req, "tutor-daily-digest");
  if (probe) return probe;
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
  // 22.09: усі три запити «по всій платформі» — сторінками (див. _shared/fetchAll.ts).
  const { data: todayRaw, error: todayErr } = await fetchAllRows<any>((a, b) => sb
    .from("lessons")
    .select("id, tutor_id, student_id, starts_at, subject, source, lesson_details(student_price, student_payment_status)")
    .in("status", ["scheduled", "completed"])
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at", { ascending: true })
    .order("id", { ascending: true })
    .range(a, b));
  if (todayErr) console.error("digest: today's lessons read failed", todayErr.message);
  const todayLessons = todayRaw;

  // ЄДИНЕ визначення боргів = src/lib/financials.ts (isStudentDebtLesson /
  // isPayoutDueLesson). Дайджест ДЗЕРКАЛИТЬ його дослівно — розбіжність цифр
  // телеграм↔застосунок була саме тут (дайджест брав лише completed).
  const { data: moneyRaw, error: moneyErr } = await fetchAllRows<any>((a, b) => sb
    .from("lessons")
    .select("id, tutor_id, student_id, subject, source, status, starts_at, group_id, lesson_details(student_price, student_payment_status, tutor_payout, tutor_payout_status, is_cancellation_fee)")
    .in("status", ["completed", "scheduled", "cancelled"])
    .order("id", { ascending: true })
    .range(a, b));
  if (moneyErr) console.error("digest: money read failed", moneyErr.message);
  const BUILD_TAG = "v25.09-uxstep51";
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
  // 13.09 (запит власниці): менеджерка з трьома репетиторами не отримала ЖОДНОГО
  // слова про те, що САМА винна репетиторам. Був лише голий підсумок «до виплати»,
  // а коли ставки виплат не поставлені — і його не було: tutor_payout = null, тож
  // борг школи перед репетитором СТРУКТУРНО невидимий. Тому окремо збираємо
  // проведені уроки БЕЗ ставки виплати — це і є невидимий борг, і менеджер
  // мусить його бачити в тому самому ранковому повідомленні.
  const isConductedUnrated = (l: any) => {
    const d = detailOf(l) ?? {};
    if (l.group_id || l.status === "cancelled") return false;
    if (d.tutor_payout_status === "paid") return false;
    if (Number(d.tutor_payout ?? 0) > 0) return false;
    return l.status === "completed" || new Date(l.starts_at).getTime() <= nowMs;
  };
  const unratedLessons = (moneyRaw ?? []).filter((l: any) => l.source !== "independent" && isConductedUnrated(l));

  // ГРУПОВІ борги — по УЧАСНИКАХ (parent ПРОВЕДЕНИЙ, учасник unpaid&price>0).
  // 07.09: було completed|scheduled — майбутні групові уроки рахувались боргом,
  // усупереч моделі 04.09 (борг = проведене) і цифрі у «Фінансах».
  const { data: groupRaw, error: groupErr } = await fetchAllRows<any>((a, b) => sb
    .from("lessons")
    .select("id, tutor_id, source, status, lesson_participants(student_id, student_price, student_payment_status)")
    .not("group_id", "is", null)
    .eq("status", "completed")
    .order("id", { ascending: true })
    .range(a, b));
  if (groupErr) console.error("digest: group money read failed", groupErr.message);
  // Гроші не прочитались ЦІЛКОМ — тоді жодних «✅ Всі оплати закриті» і
  // жодних неповних сум: чесний рядок «не вдалося перевірити».
  const moneyFailed = !!(moneyErr || groupErr);
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

  // Мертвий вимикач (27.09): зведення нічних/погодинних процесів — ЛИШЕ
  // суперадміну (platform_admins). Нуль там, де вчора було сорок, — тривога,
  // яку видно з телефона, а не з логів Supabase, яких ніхто не бачить.
  const { data: adminRows } = await sb.from("platform_admins").select("user_id");
  const superadmins = new Set<string>((adminRows ?? []).map((r: any) => String(r.user_id)));
  const EXPECTED_DAILY_JOBS = [
    "tutor-daily-digest", "tutor-evening-summary", "payment-reminders", "lesson-reminders",
    "db-backup", "telegram-poll", "scheduled-notifications",
  ];
  let jobHealth: any[] | null = null;
  if (superadmins.size) {
    try {
      // RPC з міграції 20260927170000 — до перегенерації types.ts через (rpc as any)
      const { data, error } = await (sb.rpc as any)("job_health", { _hours: 26 });
      if (error) throw error;
      jobHealth = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error("job_health unavailable:", (e as any)?.message ?? e);
      jobHealth = null;
    }
  }
  // Цикл «вчимося з продакшену» (13.09): імпорт пише в app_events, які рядки не
  // впізнав — форму, не зміст. Раніше ці записи ніхто не читав. Тепер суперадмін
  // бачить раз на день: скільки списків спіткнулось і на чому — це і є дані для
  // рішення «чи потрібен AI-фолбек парсера», без вигадок.
  let importLoop: { lists: number; rows: number; top: string } | null = null;
  if (superadmins.size) {
    try {
      const { data: ev } = await sb
        .from("app_events")
        .select("props")
        .eq("name", "import_unrecognized")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
        .limit(500);
      const counts = new Map<string, number>();
      let rows = 0;
      for (const e of ev ?? []) {
        const shapes = (e as any)?.props?.shapes;
        if (!Array.isArray(shapes)) continue;
        for (const sh of shapes) {
          const key = String(sh?.shape ?? "?").slice(0, 40);
          counts.set(key, (counts.get(key) ?? 0) + 1);
          rows += 1;
        }
      }
      if ((ev ?? []).length) {
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${esc(k)} ×${v}`).join(", ") || "—";
        importLoop = { lists: (ev ?? []).length, rows, top };
      }
    } catch (e) {
      console.error("import loop summary failed:", (e as any)?.message ?? e);
    }
  }
  // Зведення читається людиною з телефона: по рядку на кожен очікуваний процес.
  // Сам ранковий дайджест зі списку «не запускався» виключено — його рядок
  // пишеться ПІСЛЯ відповіді, тобто в момент читання цей запуск ще не в журналі
  // (30.09 перший дайджест доповів «⛔ не запускався» сам на себе).
  const SELF = "tutor-daily-digest";
  const primaryCount = (counts: any): number | null => {
    if (!counts || typeof counts !== "object") return null;
    for (const k of ["sent", "processed", "created", "tables", "linked", "delivered", "count"]) {
      if (typeof counts[k] === "number") return counts[k];
    }
    return null;
  };
  const jobLines = (D: any): string[] => {
    if (jobHealth === null) return [D.jobsUnknown];
    const byJob = new Map<string, any>(jobHealth.map((j) => [String(j.job), j]));
    const out: string[] = [D.jobsTitle];
    const line = (name: string, j: any | undefined) => {
      if (!j) { out.push(`⛔ ${esc(D.jobName(name))} — ${D.jobMissing}`); return; }
      const failures = Number(j.failures ?? 0);
      const runs = Number(j.runs ?? 0);
      const n = primaryCount(j.last_counts);
      const tail = n !== null ? ` — ${n}` : runs > 1 ? ` — ${runs}×` : "";
      if (failures > 0) {
        out.push(`⚠ ${esc(D.jobName(name))}${tail} · ${D.jobFailed(failures)}: ${esc(String(j.last_error ?? "").slice(0, 100) || "?")}`);
      } else {
        out.push(`✓ ${esc(D.jobName(name))}${tail}`);
      }
    };
    for (const name of EXPECTED_DAILY_JOBS.filter((x) => x !== SELF)) line(name, byJob.get(name));
    for (const [name, j] of byJob) {
      if (EXPECTED_DAILY_JOBS.includes(name) || name === SELF) continue;
      if (Number(j.failures ?? 0) > 0) line(name, j);
    }
    return out;
  };

  // Школи (модель «школа = сутність», 07.09): менеджер бачить у дайджесті лише
  // уроки/борги репетиторів СВОЄЇ школи. Джерело — hub_managers × settings.hub_id.
  // До застосування етапу A таблиці ще немає — тоді (і лише тоді) поведінка
  // стара: усе хабове. manager_debts_summary під service role повертала нулі
  // (auth.uid() порожній), тому тотали рахуємо тут — тими самими предикатами.
  const { data: hubMgrRows, error: hubErr } = await sb.from("hub_managers").select("user_id, hub_id");
  const hubModel = !hubErr;
  const hubOfManager = new Map<string, string>((hubMgrRows ?? []).map((r: any) => [r.user_id, r.hub_id]));
  const { data: hubTutorRows } = hubModel
    ? await sb.from("tutor_workspace_settings").select("tutor_id, hub_id").not("hub_id", "is", null)
    : { data: [] as any[] };
  const hubOfTutor = new Map<string, string>((hubTutorRows ?? []).map((r: any) => [r.tutor_id, r.hub_id]));
  /** Урок належить школі менеджера (або hub-модель ще не застосована). */
  const inManagerHub = (managerId: string, tutorId: string) =>
    !hubModel || hubOfTutor.get(tutorId) === hubOfManager.get(managerId);

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

  // Репетитори, яким школа винна або в яких є проведені уроки без ставки: імена
  // (profiles) і графік виплат (tutor_details) — один запит на всіх, до циклу.
  const payoutTutorIds = Array.from(new Set([
    ...payoutDueLessons.filter((l: any) => l.source !== "independent").map((l: any) => l.tutor_id),
    ...unratedLessons.map((l: any) => l.tutor_id),
  ]));
  const { data: payoutTutors } = payoutTutorIds.length
    ? await sb.from("profiles").select("id, first_name, last_name").in("id", payoutTutorIds)
    : { data: [] };
  const tutorName = new Map<string, string>(
    (payoutTutors ?? []).map((p: any) => [p.id, `${(p.first_name ?? "")} ${(p.last_name ?? "")}`.trim() || "—"])
  );
  const { data: schedules } = payoutTutorIds.length
    ? await sb.from("tutor_details").select("user_id, payout_frequency, payout_weekday, payout_monthday, payout_anchor").in("user_id", payoutTutorIds)
    : { data: [] };
  const kyivToday = kyivNow();
  const payoutDueTodayFor = new Set<string>(
    (schedules ?? []).filter((s: any) => isPayoutDueToday(s, kyivToday)).map((s: any) => s.user_id)
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
      // Manager: уроки центру (source != independent) — лише СВОЄЇ школи
      const mine = (l: any) => l.source !== "independent" && inManagerHub(userId, l.tutor_id);
      const myLessons = (todayLessons ?? []).filter(mine);
      if (todayErr) {
        lines.push(D.todayUnavailable);
      } else if (myLessons.length === 0) {
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
      // Тотали — ті самі предикати, що й у «Фінансах» (financials.ts), у межах школи.
      const sd = (unpaidLessons ?? []).filter(mine).reduce((a: number, l: any) => a + Number(detailOf(l)?.student_price ?? 0), 0)
        + groupDebtRows.filter(mine).reduce((a: number, r: any) => a + r.price, 0);
      const po = payoutDueLessons.filter(mine).reduce((a: number, l: any) => a + Number(detailOf(l)?.tutor_payout ?? 0), 0);
      if (moneyFailed) lines.push(D.moneyUnavailable);
      else if (sd > 0) lines.push(D.debt(`${sd} ₴`));
      // 07.09 (запит власниці): менеджер бачив лише підсумок і не мав «рук».
      // Тепер — хто саме винен (ХАБОВІ борги: source ≠ independent, ті самі
      // предикати, що й у Фінансах) і кнопка «оплатив(ла)» на кожного: саме
      // менеджер закриває хабові борги — і в застосунку, і тут. Обробляє
      // telegram-poll (hpaid:), автор дії = власник chat_id з роллю manager.
      const hubDebts = new Map<string, number>();
      for (const l of (unpaidLessons ?? []).filter(mine)) {
        hubDebts.set(l.student_id, (hubDebts.get(l.student_id) ?? 0) + Number(detailOf(l)?.student_price ?? 0));
      }
      for (const r of groupDebtRows.filter(mine)) {
        hubDebts.set(r.student_id, (hubDebts.get(r.student_id) ?? 0) + r.price);
      }
      if (!moneyFailed && hubDebts.size > 0) {
        lines.push(D.mgrDebtors);
        for (const [sid, amount] of Array.from(hubDebts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
          lines.push(`• ${esc(studentName.get(sid))} — ${amount} ₴`);
          const nm = shortName(studentName.get(sid), D.btnName);
          keyboard.push([{ text: D.btnPaid(nm), callback_data: `hpaid:${sid}` }]);
        }
        if (hubDebts.size > 5) lines.push(D.moreStudents(hubDebts.size - 5));
      }
      // 13.09 (запит власниці): «я сліпа, коли йдеться про борги репетиторам».
      // Замість голого підсумку — хто саме, скільки, за скільки уроків, чи
      // сьогодні день виплати за графіком, і кнопка «Виплатив(ла)» на кожного
      // (обробляє telegram-poll, tpaid:; ті самі уроки, що й RPC
      // mark_tutor_payouts_paid — проведені, неоплачені, зі ставкою > 0).
      const owed = new Map<string, { sum: number; n: number }>();
      for (const l of payoutDueLessons.filter(mine)) {
        const cur = owed.get(l.tutor_id) ?? { sum: 0, n: 0 };
        cur.sum += Number(detailOf(l)?.tutor_payout ?? 0);
        cur.n += 1;
        owed.set(l.tutor_id, cur);
      }
      if (!moneyFailed && po > 0 && owed.size > 0) {
        lines.push(D.owe(`${po} ₴`));
        const sorted = Array.from(owed.entries()).sort((a, b) => b[1].sum - a[1].sum);
        for (const [tid, v] of sorted.slice(0, 5)) {
          const today = payoutDueTodayFor.has(tid) ? D.payoutToday : "";
          lines.push(D.oweLine(esc(tutorName.get(tid)), `${v.sum} ₴`, v.n, D.lessons(v.n)) + today);
          const nm = shortName(tutorName.get(tid), D.btnTutorName);
          keyboard.push([{ text: D.btnPayoutPaid(nm), callback_data: `tpaid:${tid}` }]);
        }
        if (sorted.length > 5) lines.push(D.moreTutors(sorted.length - 5));
      }
      // Проведені уроки без суми виплати — невидимий борг школи: сума невідома
      // не тому, що її немає, а тому, що ставку не поставили. Кнопка веде
      // ПРЯМО у форму ставки цього репетитора (21.09, розрив у флоу: раніше —
      // в аркуш у «Людях», де ще треба було знайти олівець), а коли всі його
      // уроки без суми з одного предмета — і предмет уже підставлений.
      const unrated = new Map<string, { n: number; subjects: Set<string> }>();
      for (const l of unratedLessons.filter(mine)) {
        const cur = unrated.get(l.tutor_id) ?? { n: 0, subjects: new Set<string>() };
        cur.n += 1;
        if (l.subject) cur.subjects.add(String(l.subject));
        unrated.set(l.tutor_id, cur);
      }
      for (const [tid, v] of Array.from(unrated.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 3)) {
        lines.push(D.noRate(esc(tutorName.get(tid)), v.n, D.lessons(v.n)));
        const subj = v.subjects.size === 1 ? `&subject=${encodeURIComponent(Array.from(v.subjects)[0])}` : "";
        keyboard.push([{ text: D.btnRate(shortName(tutorName.get(tid), D.btnTutorName)), url: `${APP_URL}/people?open=${tid}&rate=1${subj}` }]);
      }
      if ((errCount ?? 0) > 0) lines.push(D.errors(Number(errCount)));
      if (superadmins.has(userId)) {
        lines.push(...jobLines(D));
        if (importLoop) lines.push(D.importLoop(importLoop.lists, importLoop.rows, importLoop.top));
      }
      // Передоплата — це форма з сумою/кількістю уроків, тож не callback, а
      // прямий перехід у застосунок на потрібну вкладку.
      keyboard.push([{ text: D.btnPrepay, url: PREPAY_URL }]);
    } else if (isTutor) {
      // Tutor: their own lessons
      const myLessons = (todayLessons ?? []).filter((l: any) => l.tutor_id === userId);
      if (todayErr) {
        lines.push(D.todayUnavailable);
      } else if (myLessons.length === 0) {
        lines.push(D.tutNone);
      } else {
        lines.push(D.tutToday(myLessons.length, D.lessons(myLessons.length)));
        for (const l of myLessons) {
          const t = new Date(l.starts_at).toLocaleTimeString("uk-UA", {
            timeZone: TZ, hour: "2-digit", minute: "2-digit",
          });
          // ✅ «учень оплатив» — лише на ВЛАСНИХ уроках: для хабового це оплата
          // школі, яку застосунок йому свідомо не показує (маска lessons_visible).
          const paid = l.source === "independent" && detailOf(l)?.student_payment_status === "paid" ? " ✅" : "";
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
      // 22.09 (аудит 18.09, підтверджено): тут не було фільтра за source, тож
      // ХАБОВИЙ репетитор щоранку отримував «Нагадай про оплату: 12 400 ₴ ·
      // Марія — 3 200 ₴» — а це ціни ШКОЛИ, тобто борг учня перед школою. Функція
      // ходить службовим ключем і обходить маску lessons_visible, яка в
      // застосунку спеціально ховає student_price від хабового. Він бачив чужу
      // дебіторку, а порівнявши зі своєю виплатою — і маржу школи; до того ж ішов
      // «вибивати» гроші, які йому не належать. Борг учня перед школою — справа
      // менеджера, тож у дайджесті репетитора лишаються ЛИШЕ його власні учні.
      for (const l of (unpaidLessons ?? []).filter((l: any) => l.tutor_id === userId && l.source === "independent")) {
        noteDebt(l.student_id, Number(detailOf(l)?.student_price ?? 0), l.source);
      }
      for (const r of groupDebtRows.filter((r: any) => r.tutor_id === userId && r.source === "independent")) {
        noteDebt(r.student_id, r.price, r.source);
      }
      // Незалежному передоплата — головний спосіб отримати гроші наперед:
      // одна кнопка веде просто у форму. Хабовому не показуємо: його
      // передоплати записує менеджер (у застосунку форма йому теж не рендериться).
      const hasIndependent = (moneyRaw ?? []).some((l: any) => l.tutor_id === userId && l.source === "independent")
        || (todayLessons ?? []).some((l: any) => l.tutor_id === userId && l.source === "independent");
      // 22.09: блок про оплати учнів — ЛИШЕ тому, хто сам їх збирає. Хабовому
      // (після фільтра вище) він завжди був би порожнім і казав би «✅ Всі
      // оплати закриті» — неправду про гроші школи, яких він не бачить.
      if (!hasIndependent) {
        // нічого: оплати учнів хабового — справа менеджера
      } else if (moneyFailed) {
        lines.push(D.moneyUnavailable);
      } else if (myDebts.size > 0) {
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
      if (hasIndependent) keyboard.push([{ text: D.btnPrepay, url: PREPAY_URL }]);
    } else {
      continue; // Student — не відправляємо
    }

    // Тег збірки — лише у відповіді функції (для перевірки деплою), НЕ в
    // повідомленні людині: «v v25.09-uxstep50» у ранковому привітанні — це
    // сміття, яке власниця побачила першою (07.09).
    const ok = await sendTg(BOT, chatId, lines.join("\n"), keyboard);
    if (ok) {
      await sb.from("tutor_daily_digests").insert({
        tutor_id: userId, digest_date: today, channel: "telegram",
      });
      sent++;
    }
  }

  return new Response(JSON.stringify({ ok: true, date: today, sent, build: BUILD_TAG }), {
    headers: { "Content-Type": "application/json" },
  });
}));
