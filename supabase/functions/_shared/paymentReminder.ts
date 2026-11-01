// Єдине ядро «нагадати учневі про оплату». Викликають:
//   • remind-payment     (HTTP, актор з JWT)          — кнопка в застосунку
//   • telegram-poll      (callback, актор з chat_id)   — кнопка в дайджесті
//   • payment-reminders  (cron, service role)          — автоматичні нагадування
//
// Чому одне ядро: у 50-й хвилі кнопка Telegram робила ВЛАСНИЙ insert у
// notifications і не писала в lesson_payment_reminders. Наслідок — десять
// натискань = десять пушів учневі, а крон payment-reminders (який тримає
// ідемпотентність саме за цим логом) міг надіслати те саме ще раз.
// 01.11 (пакет «Правда»): і крон іде цим ядром — одна пара = одне повідомлення
// про весь борг, з посиланням на оплату, і ОДНЕ правило доставки для всіх.
//
// ПРАВИЛО ДОСТАВКИ (01.11, Рада 26.10, п. 1): нагадування «надіслане» лише
// тоді, коли воно справді комусь прийшло — Telegram, пошта або push. Дзвіночок
// у застосунку — не доставка для того, хто застосунок не відкриває: учню без
// акаунта (pending-профіль) дзвіночок не ставимо взагалі, а репетиторці
// повертаємо готовий текст від її імені з посиланням, щоб вона переслала сама у
// Viber/Telegram одним дотиком. У лічильник «нагадано за вас» (tutor_reminder_
// stats) потрапляють лише справжні канали й пересилання — не дзвіночок.
//
// Дедуплікація: create_notification (з її 24-годинним вікном) вимагає
// auth.uid() і недоступна з service-role — тому і remind-payment робить прямий
// insert. Єдина спільна точка ідемпотентності, доступна всім, — це той самий
// лог lesson_payment_reminders, за яким живе крон. Тут він і перевіряється.

// deno-lint-ignore-file no-explicit-any
import { sendWebPush } from "./push.ts";

const RLOC: Record<string, string> = { uk: "uk-UA", en: "en-GB", sv: "sv-SE" };
const RSYM: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", GBP: "£", SEK: "kr", PLN: "zł" };
export type RemLang = "uk" | "en" | "sv";

/** Тон повідомлення: від чого воно (ручне / до уроку / після / передоплата вичерпана). */
export type ReminderTone = "manual" | "before" | "after" | "prepaid_out";

const T = {
  uk: {
    header: (tutor: string) => `💳 Повідомлення від ${tutor}`,
    tutorFallback: "репетитор",
    greet: (name: string) => (name ? `Привіт, ${name}!` : "Привіт!"),
    tone: {
      manual: "Нагадую про оплату уроків:",
      before: "Нагадую про оплату перед уроком:",
      after: "Дякую за урок! Нагадую про оплату:",
      prepaid_out: "Передоплата закінчилась — нагадую про оплату наступних уроків:",
    } as Record<ReminderTone, string>,
    lessonLine: (subj: string, date: string, sum: string) => `• ${subj} — ${date}${sum ? ` — ${sum}` : ""}`,
    total: (n: number, sum: string) => `Разом: ${n} ${n === 1 ? "урок" : n < 5 ? "уроки" : "уроків"}${sum ? ` — ${sum}` : ""}`,
    payLink: "Реквізити й кнопка «Я оплатив(ла)» — за посиланням:",
    register: "Хочеш бачити домашку, конспекти й розклад? Створи акаунт учня:",
    inappBody: (n: number) => `${n} ур. очікують на оплату.`,
    // Репетиторці, коли доставити нема куди:
    undeliveredTitle: (name: string) => `Нагадування для ${name} не доставлено`,
    undeliveredBody: "Немає Telegram чи пошти. Перешли сама — текст уже готовий, один дотик.",
    undeliveredTg: (name: string) => `⚠️ <b>${name}</b> ще не підключив(ла) Telegram чи пошту — нагадування не дійде саме.\nПерешли це повідомлення у Viber або Telegram (один дотик «Переслати»):`,
  },
  en: {
    header: (tutor: string) => `💳 Message from ${tutor}`,
    tutorFallback: "your tutor",
    greet: (name: string) => (name ? `Hi ${name}!` : "Hi!"),
    tone: {
      manual: "A reminder about lesson payment:",
      before: "A reminder to pay before the lesson:",
      after: "Thanks for the lesson! A payment reminder:",
      prepaid_out: "Your prepayment has run out — a reminder for the next lessons:",
    } as Record<ReminderTone, string>,
    lessonLine: (subj: string, date: string, sum: string) => `• ${subj} — ${date}${sum ? ` — ${sum}` : ""}`,
    total: (n: number, sum: string) => `Total: ${n} ${n === 1 ? "lesson" : "lessons"}${sum ? ` — ${sum}` : ""}`,
    payLink: "Payment details and the «I’ve paid» button:",
    register: "Want to see homework, notes and the timetable? Create a student account:",
    inappBody: (n: number) => `${n} lessons are awaiting payment.`,
    undeliveredTitle: (name: string) => `Reminder for ${name} was not delivered`,
    undeliveredBody: "No Telegram or email. Forward it yourself — the text is ready, one tap.",
    undeliveredTg: (name: string) => `⚠️ <b>${name}</b> hasn’t connected Telegram or email yet — the reminder can’t reach them by itself.\nForward this message in Viber or Telegram (one tap «Forward»):`,
  },
  sv: {
    header: (tutor: string) => `💳 Meddelande från ${tutor}`,
    tutorFallback: "din lärare",
    greet: (name: string) => (name ? `Hej ${name}!` : "Hej!"),
    tone: {
      manual: "En påminnelse om betalning för lektioner:",
      before: "En påminnelse att betala före lektionen:",
      after: "Tack för lektionen! En betalningspåminnelse:",
      prepaid_out: "Förskottsbetalningen är slut — påminnelse för kommande lektioner:",
    } as Record<ReminderTone, string>,
    lessonLine: (subj: string, date: string, sum: string) => `• ${subj} — ${date}${sum ? ` — ${sum}` : ""}`,
    total: (n: number, sum: string) => `Totalt: ${n} ${n === 1 ? "lektion" : "lektioner"}${sum ? ` — ${sum}` : ""}`,
    payLink: "Betalningsuppgifter och knappen «Jag har betalat»:",
    register: "Vill du se läxor, anteckningar och schema? Skapa ett elevkonto:",
    inappBody: (n: number) => `${n} lektioner väntar på betalning.`,
    undeliveredTitle: (name: string) => `Påminnelsen till ${name} levererades inte`,
    undeliveredBody: "Ingen Telegram eller e-post. Vidarebefordra själv — texten är klar, ett tryck.",
    undeliveredTg: (name: string) => `⚠️ <b>${name}</b> har inte kopplat Telegram eller e-post ännu — påminnelsen når inte fram av sig själv.\nVidarebefordra detta meddelande i Viber eller Telegram (ett tryck «Vidarebefordra»):`,
  },
} as const;

export function normLang(v: unknown): RemLang {
  return v === "en" || v === "sv" ? v : "uk";
}
export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type ReminderLesson = {
  id: string; subject: string | null; starts_at: string;
  student_price: number | null; currency?: string | null;
};

export type ReminderKind = "manual" | "telegram_button" | "prepaid" | "before_lesson" | "after_lesson";

export type ReminderInput = {
  admin: any;                       // service-role client
  supabaseUrl: string;
  serviceKey: string;
  botToken: string | undefined;
  tutorId: string;
  studentId: string;
  lessons: ReminderLesson[];        // усі незакриті уроки пари, які хочемо нагадати
  kind: ReminderKind;
  /** Тон тексту; за замовчуванням виводиться з kind. */
  tone?: ReminderTone;
  dedupHours?: number;              // за замовчуванням 24
  /** Дедуплікувати лише проти нагадувань цього ж виду (наприклад, ручне —
      лише проти ручного), а не будь-якого каналу за добу. */
  dedupKind?: ReminderKind;
  /** Слати web push (крон); кнопка в застосунку й так на екрані. */
  webPush?: boolean;
};

export type ReminderResult = {
  sent: number;                     // скільки уроків реально пішло в нагадування
  skipped: number;                  // скільки відсіяно дедуплікацією
  channels: string[];               // telegram | email | webpush | inapp
  lang: RemLang;
  /** true = нікому не прийшло (учень без акаунта і без каналів); репетиторці
      віддано готовий текст. */
  undelivered?: boolean;
  /** Готовий текст для пересилання (завжди, якщо є що нагадувати). */
  shareText?: string;
  payUrl?: string;
  /** Коли востаннє йшло нагадування по цих уроках (для пояснення, чому пропущено). */
  lastSentAt?: string | null;
};

/** Канали, які справді доставляють людині. Дзвіночок — ні. */
export const REAL_CHANNELS = ["telegram", "email", "webpush"] as const;

function toneOf(kind: ReminderKind): ReminderTone {
  if (kind === "before_lesson") return "before";
  if (kind === "after_lesson") return "after";
  if (kind === "prepaid") return "prepaid_out";
  return "manual";
}

export async function sendPaymentReminder(input: ReminderInput): Promise<ReminderResult> {
  const { admin, supabaseUrl, serviceKey, botToken, tutorId, studentId, kind } = input;
  const dedupHours = input.dedupHours ?? 24;
  const tone = input.tone ?? toneOf(kind);

  // 1) Дедуплікація за логом крона: урок, нагадування про який пішло за останні
  //    dedupHours будь-яким каналом, не нагадуємо повторно. Рядок «undelivered»
  //    теж рахується — репетиторці не треба щогодини повторювати, що мама без
  //    Telegram.
  const since = new Date(Date.now() - dedupHours * 3600_000).toISOString();
  const ids = input.lessons.map((l) => l.id);
  let recentQ = ids.length
    ? admin.from("lesson_payment_reminders").select("lesson_id, sent_at")
        .in("lesson_id", ids).eq("student_id", studentId).gte("sent_at", since)
    : null;
  if (recentQ && input.dedupKind) recentQ = recentQ.eq("reminder_kind", input.dedupKind);
  const { data: recent } = recentQ ? await recentQ : { data: [] };
  const already = new Set((recent ?? []).map((r: any) => r.lesson_id));
  const fresh = input.lessons.filter((l) => !already.has(l.id));
  if (fresh.length === 0) {
    const lastSentAt = (recent ?? []).map((r: any) => String(r.sent_at)).sort().pop() ?? null;
    return { sent: 0, skipped: input.lessons.length, channels: [], lang: "uk", lastSentAt };
  }

  // 2) Люди, контакти, мова
  const [{ data: sp }, { data: tp }, { data: contact }, { data: tg }] = await Promise.all([
    admin.from("profiles").select("first_name, last_name, preferred_language, is_pending").eq("id", studentId).maybeSingle(),
    admin.from("profiles").select("first_name, last_name, preferred_language").eq("id", tutorId).maybeSingle(),
    admin.from("profile_contacts").select("email").eq("user_id", studentId).maybeSingle(),
    admin.from("user_telegram_links").select("chat_id").eq("user_id", studentId).maybeSingle(),
  ]);
  const lang = normLang(sp?.preferred_language);
  const tr = T[lang];
  const studentFirst = String(sp?.first_name ?? "").trim();
  const studentName = [sp?.first_name, sp?.last_name].filter(Boolean).join(" ").trim() || "—";
  const tutorName = [tp?.first_name, tp?.last_name].filter(Boolean).join(" ").trim() || tr.tutorFallback;
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(RLOC[lang], {
    timeZone: "Europe/Kyiv", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const sym = (c?: string | null) => RSYM[c ?? "UAH"] ?? (c ?? "₴");
  const total = fresh.reduce((s, l) => s + Number(l.student_price ?? 0), 0);
  // Сума має сенс лише якщо валюта одна — інакше чесно не показуємо число.
  const currencies = new Set(fresh.map((l) => l.currency ?? "UAH"));
  const oneCurrency = currencies.size === 1;
  const sumOf = (l: ReminderLesson) => Number(l.student_price ?? 0) > 0 ? `${Number(l.student_price)} ${sym(l.currency)}` : "";
  const totalStr = total > 0 && oneCurrency ? `${total} ${sym(fresh[0].currency)}` : "";

  // 13.10: магічне посилання на публічну сторінку «борг · реквізити · Я оплатив(ла)»
  // — у КОЖНОМУ нагадуванні, щоб відповісти можна було одним дотиком без входу.
  // 01.11: коротке посилання /p/<код> (стабільне для пари) — довге виглядало
  // у Viber як фішинг.
  const appUrl = (Deno.env.get("APP_URL") ?? "https://otutorhub.com").replace(/\/+$/, "");
  let payUrl = "";
  try {
    const { data: code } = await (admin.rpc as any)("payment_link_for_pair", { _tutor_id: tutorId, _student_id: studentId });
    if (typeof code === "string" && /^[a-z0-9]{8}$/.test(code)) payUrl = `${appUrl}/p/${code}`;
    else if (typeof code === "string" && /^[0-9a-f]{64}$/.test(code)) payUrl = `${appUrl}/pay/${code}`;
  } catch { /* без посилання нагадування все одно піде */ }

  // 13.10 (рішення власниці): учню без акаунта — нагадати, що він може його створити.
  const isPending = !!sp?.is_pending;
  const registerUrl = isPending ? `${appUrl}/auth?signup=1&role=student` : "";

  // Текст — ВІД ПЕРШОЇ ОСОБИ репетиторки, один список уроків, одна сума.
  const lines = fresh
    .slice()
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((l) => tr.lessonLine(l.subject ?? "—", fmtDate(l.starts_at), sumOf(l)));
  const plain = [
    tr.greet(studentFirst),
    tr.tone[tone],
    ...lines,
    fresh.length > 1 || !totalStr ? tr.total(fresh.length, totalStr) : "",
    payUrl ? `${tr.payLink}\n${payUrl}` : "",
  ].filter(Boolean).join("\n");
  const shareText = `${plain}\n— ${tutorName}`;

  const channels: string[] = [];

  // 3) Telegram
  const chatId = tg?.chat_id ? Number(tg.chat_id) : null;
  if (chatId && botToken) {
    const text = `<b>${esc(tr.header(tutorName))}</b>\n\n${esc(plain)}${registerUrl ? `\n\n${esc(tr.register)}\n${registerUrl}` : ""}`;
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (r.ok) channels.push("telegram");
  }

  // 4) Email — тим самим шаблоном, що й кнопка в застосунку
  const email = contact?.email?.trim();
  if (email) {
    const first = fresh[0];
    const r = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({
        templateName: "payment-reminder",
        recipientEmail: email,
        idempotencyKey: `payment-reminder:${first.id}:${new Date().toISOString().slice(0, 13)}`,
        templateData: {
          studentName, tutorName, subject: first.subject ?? "—",
          lessonDate: fmtDate(first.starts_at), amount: total, lessonsCount: fresh.length, lang,
          payUrl: payUrl || undefined,
          registerUrl: registerUrl || undefined,
        },
      }),
    });
    if (r.ok) channels.push("email");
  }

  // 4b) Web push (крон) — лише тому, хто має акаунт і дозволив push.
  if (input.webPush && !isPending) {
    const ok = await sendWebPush(supabaseUrl, serviceKey, {
      userId: studentId,
      title: tr.header(tutorName),
      body: tr.inappBody(fresh.length),
      link: "/student/payments",
      tag: `payrem-${tutorId}`,
      actions: [{ action: "ipaid", title: lang === "uk" ? "Я оплатив" : lang === "sv" ? "Jag har betalat" : "I paid", link: `/student/payments?paid=${tutorId}` }],
    });
    if (ok) channels.push("webpush");
  }

  // 5) In-app дзвіночок — лише тому, хто застосунок має. Pending-профіль
  //    дзвіночка не відкриє ніколи, тож для нього це не доставка.
  if (!isPending) {
    await admin.from("notifications").insert({
      user_id: studentId, type: "payment_reminder",
      title: tr.header(tutorName), body: tr.inappBody(fresh.length), link: "/student/payments",
    });
    channels.push("inapp");
  }

  const delivered = channels.some((c) => (REAL_CHANNELS as readonly string[]).includes(c)) || channels.includes("inapp");

  // 6) Лог — саме за ним крон і наступні натискання тримають ідемпотентність.
  //    Нікому не прийшло → рядок «undelivered»: дедуп тримає, а лічильник
  //    «нагадано за вас» такий рядок не рахує.
  const sentAt = new Date().toISOString();
  const logChannels = delivered ? channels : ["undelivered"];
  const rows = fresh.flatMap((l) => logChannels.map((ch) => ({
    lesson_id: l.id, tutor_id: tutorId, student_id: studentId, reminder_kind: kind, channel: ch, sent_at: sentAt,
  })));
  if (rows.length) {
    const { error: logErr } = await admin
      .from("lesson_payment_reminders")
      .upsert(rows, { onConflict: "lesson_id,student_id,reminder_kind,channel" });
    if (logErr) console.error("[paymentReminder] лог не записався:", logErr.message);
  }

  if (!delivered) {
    // Репетиторці — чесно і з готовим текстом: дзвіночок у застосунку з
    // переходом в аркуш «Нагадати» цього учня, і те саме в її Telegram, якщо
    // підключений (один дотик «Переслати» у Viber/Telegram).
    const tlang = normLang(tp?.preferred_language);
    const tt = T[tlang];
    await admin.from("notifications").insert({
      user_id: tutorId, type: "reminder_undelivered",
      title: tt.undeliveredTitle(studentName), body: tt.undeliveredBody,
      link: `/finances?tab=debts&remind=${studentId}`,
    });
    if (botToken) {
      const { data: tlink } = await admin.from("user_telegram_links").select("chat_id").eq("user_id", tutorId).maybeSingle();
      if (tlink?.chat_id) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(tlink.chat_id), text: tt.undeliveredTg(esc(studentName)), parse_mode: "HTML", disable_web_page_preview: true }),
        }).catch(() => {});
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(tlink.chat_id), text: shareText, disable_web_page_preview: true }),
        }).catch(() => {});
      }
    }
    return { sent: 0, skipped: input.lessons.length - fresh.length, channels: [], lang, undelivered: true, shareText, payUrl };
  }

  return { sent: fresh.length, skipped: input.lessons.length - fresh.length, channels, lang, shareText, payUrl };
}
