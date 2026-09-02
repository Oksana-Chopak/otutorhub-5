// Єдине ядро «нагадати учневі про оплату». Викликають:
//   • remind-payment (HTTP, актор з JWT)          — кнопка в застосунку
//   • telegram-poll  (callback, актор з chat_id)   — кнопка в дайджесті
//
// Чому одне ядро: у 50-й хвилі кнопка Telegram робила ВЛАСНИЙ insert у
// notifications і не писала в lesson_payment_reminders. Наслідок — десять
// натискань = десять пушів учневі, а крон payment-reminders (який тримає
// ідемпотентність саме за цим логом) міг надіслати те саме ще раз.
//
// Дедуплікація: create_notification (з її 24-годинним вікном) вимагає
// auth.uid() і недоступна з service-role — тому і remind-payment робить прямий
// insert. Єдина спільна точка ідемпотентності, доступна обом, — це той самий
// лог lesson_payment_reminders, за яким живе крон. Тут він і перевіряється.

// deno-lint-ignore-file no-explicit-any

const RLOC: Record<string, string> = { uk: "uk-UA", en: "en-GB", sv: "sv-SE" };
const RSYM: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", GBP: "£", SEK: "kr", PLN: "zł" };
export type RemLang = "uk" | "en" | "sv";

const T = {
  uk: {
    header: "💳 Нагадування про оплату",
    tutorFallback: "репетитор",
    one: (tutor: string, subj: string, date: string) => `${tutor} нагадує про оплату уроку «${subj}» (${date}).`,
    many: (tutor: string, n: number) => `${tutor} нагадує про оплату: ${n} ур. очікують на оплату.`,
    sum: "Сума", thanks: "Дякуємо! 🙏", inappBody: (n: number) => `${n} ур. очікують на оплату.`,
    footer: "Деталі — у розділі «Оплати» застосунку.",
  },
  en: {
    header: "💳 Payment reminder",
    tutorFallback: "your tutor",
    one: (tutor: string, subj: string, date: string) => `${tutor} reminds you to pay for the lesson «${subj}» (${date}).`,
    many: (tutor: string, n: number) => `${tutor} reminds you: ${n} lessons are awaiting payment.`,
    sum: "Amount", thanks: "Thank you! 🙏", inappBody: (n: number) => `${n} lessons are awaiting payment.`,
    footer: "Details are in the app's «Payments» section.",
  },
  sv: {
    header: "💳 Betalningspåminnelse",
    tutorFallback: "din lärare",
    one: (tutor: string, subj: string, date: string) => `${tutor} påminner om betalning för lektionen «${subj}» (${date}).`,
    many: (tutor: string, n: number) => `${tutor} påminner: ${n} lektioner väntar på betalning.`,
    sum: "Belopp", thanks: "Tack! 🙏", inappBody: (n: number) => `${n} lektioner väntar på betalning.`,
    footer: "Detaljer finns under «Betalningar» i appen.",
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

export type ReminderInput = {
  admin: any;                       // service-role client
  supabaseUrl: string;
  serviceKey: string;
  botToken: string | undefined;
  tutorId: string;
  studentId: string;
  lessons: ReminderLesson[];        // усі незакриті уроки пари, які хочемо нагадати
  kind: "manual" | "telegram_button";
  dedupHours?: number;              // за замовчуванням 24
};

export type ReminderResult = {
  sent: number;                     // скільки уроків реально пішло в нагадування
  skipped: number;                  // скільки відсіяно дедуплікацією
  channels: string[];               // telegram | email | inapp
  lang: RemLang;
};

export async function sendPaymentReminder(input: ReminderInput): Promise<ReminderResult> {
  const { admin, supabaseUrl, serviceKey, botToken, tutorId, studentId, kind } = input;
  const dedupHours = input.dedupHours ?? 24;

  // 1) Дедуплікація за логом крона: урок, нагадування про який пішло за останні
  //    dedupHours будь-яким каналом, не нагадуємо повторно.
  const since = new Date(Date.now() - dedupHours * 3600_000).toISOString();
  const ids = input.lessons.map((l) => l.id);
  const { data: recent } = ids.length
    ? await admin.from("lesson_payment_reminders").select("lesson_id")
        .in("lesson_id", ids).eq("student_id", studentId).gte("sent_at", since)
    : { data: [] };
  const already = new Set((recent ?? []).map((r: any) => r.lesson_id));
  const fresh = input.lessons.filter((l) => !already.has(l.id));
  if (fresh.length === 0) {
    return { sent: 0, skipped: input.lessons.length, channels: [], lang: "uk" };
  }

  // 2) Люди, контакти, мова
  const [{ data: sp }, { data: tp }, { data: contact }, { data: tg }] = await Promise.all([
    admin.from("profiles").select("first_name, last_name, preferred_language").eq("id", studentId).maybeSingle(),
    admin.from("profiles").select("first_name, last_name").eq("id", tutorId).maybeSingle(),
    admin.from("profile_contacts").select("email").eq("user_id", studentId).maybeSingle(),
    admin.from("user_telegram_links").select("chat_id").eq("user_id", studentId).maybeSingle(),
  ]);
  const lang = normLang(sp?.preferred_language);
  const tr = T[lang];
  const studentName = [sp?.first_name, sp?.last_name].filter(Boolean).join(" ").trim() || "—";
  const tutorName = [tp?.first_name, tp?.last_name].filter(Boolean).join(" ").trim() || tr.tutorFallback;
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(RLOC[lang], {
    timeZone: "Europe/Kyiv", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const sym = (c?: string | null) => RSYM[c ?? "UAH"] ?? (c ?? "₴");
  const total = fresh.reduce((s, l) => s + Number(l.student_price ?? 0), 0);
  // Сума має сенс лише якщо валюта одна — інакше чесно не показуємо число.
  const currencies = new Set(fresh.map((l) => l.currency ?? "UAH"));
  const sumLine = total > 0 && currencies.size === 1
    ? `${tr.sum}: <b>${total} ${sym(fresh[0].currency)}</b>` : "";

  const body = fresh.length === 1
    ? tr.one(tutorName, fresh[0].subject ?? "—", fmtDate(fresh[0].starts_at))
    : tr.many(tutorName, fresh.length);

  const channels: string[] = [];

  // 3) Telegram
  const chatId = tg?.chat_id ? Number(tg.chat_id) : null;
  if (chatId && botToken) {
    const text = `${tr.header}\n\n${esc(body)}${sumLine ? `\n\n${sumLine}` : ""}\n\n${tr.footer}\n${tr.thanks}`;
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
        },
      }),
    });
    if (r.ok) channels.push("email");
  }

  // 5) In-app дзвіночок — гарантований канал навіть без Telegram і email
  await admin.from("notifications").insert({
    user_id: studentId, type: "payment_reminder",
    title: tr.header, body: tr.inappBody(fresh.length), link: "/student/payments",
  });
  channels.push("inapp");

  // 6) Лог — саме за ним крон і наступні натискання тримають ідемпотентність
  const rows = fresh.flatMap((l) => channels.map((ch) => ({
    lesson_id: l.id, tutor_id: tutorId, student_id: studentId, reminder_kind: kind, channel: ch,
  })));
  if (rows.length) await admin.from("lesson_payment_reminders").insert(rows);

  return { sent: fresh.length, skipped: input.lessons.length - fresh.length, channels, lang };
}
