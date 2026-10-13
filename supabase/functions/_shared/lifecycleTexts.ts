/**
 * Тексти ланцюжка листів/Telegram (13.10, пре-мортем: «зовсім немає ланцюжка,
 * яким би ми онбордили нових, просинали неактивних»).
 *
 * Чиста функція: (крок, мова, імʼя, цифри людини) → заголовок, рядки, кнопка.
 * Жодних запитів і жодного Deno — її ганяє vitest. Кому і коли що слати, вирішує
 * база (`lifecycle_candidates`); тут — лише слова. Цифри завжди справжні цифри
 * людини: учні, уроки, борг, «нагадано за вас», «повернуто після нагадувань».
 * Якщо цифри нульові — рядок із ними не показуємо (нічого не вигадуємо).
 */

export type LifecycleKind =
  | "welcome" | "no_student_d1" | "no_lesson_d3" | "no_paid_d7"
  | "trial_7_left" | "trial_2_left" | "trial_ended"
  | "inactive_7" | "inactive_14";

export type Lang = "uk" | "en" | "sv";

export interface LifecycleNumbers {
  students: number;
  lessons: number;
  paid_lessons?: number;
  debt_lessons: number;
  debt_sum: number;
  unmarked: number;
  trial_days_left: number | null;
  reminded_times: number;
  recovered_sum: number;
  currency: string;
}

export interface LifecycleMessage {
  /** Тема листа / перший рядок у Telegram / заголовок пуша. */
  title: string;
  /** Абзаци тіла — без HTML. */
  lines: string[];
  cta: { text: string; path: string };
}

export const KINDS: LifecycleKind[] = [
  "welcome", "no_student_d1", "no_lesson_d3", "no_paid_d7",
  "trial_7_left", "trial_2_left", "trial_ended", "inactive_7", "inactive_14",
];

const SYM: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", SEK: "kr", PLN: "zł", GBP: "£" };
export const sym = (c?: string | null) => SYM[c ?? "UAH"] ?? (c ?? "₴");
const money = (n: number, c: string) => `${Math.round(Number(n) || 0)} ${sym(c)}`;

const ukLessons = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "урок" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "уроки" : "уроків");
const ukStudents = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "учень" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "учні" : "учнів");
const ukTimes = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "раз" : "разів");
const ukDays = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "дні" : "днів");

export function normLang(v: unknown): Lang {
  return v === "en" || v === "sv" ? v : "uk";
}

/** Рядок «що вже зроблено» — лише з ненульових цифр. */
function doneLine(lang: Lang, n: LifecycleNumbers): string {
  const parts: string[] = [];
  if (lang === "uk") {
    if (n.students > 0) parts.push(`${n.students} ${ukStudents(n.students)}`);
    if (n.lessons > 0) parts.push(`${n.lessons} ${ukLessons(n.lessons)}`);
    if (n.reminded_times > 0) parts.push(`нагадано за тебе ${n.reminded_times} ${ukTimes(n.reminded_times)}`);
    if (n.recovered_sum > 0) parts.push(`повернуто після нагадувань ${money(n.recovered_sum, n.currency)}`);
    return parts.length ? `Що вже є в застосунку: ${parts.join(" · ")}.` : "";
  }
  if (lang === "sv") {
    if (n.students > 0) parts.push(`${n.students} elev${n.students === 1 ? "" : "er"}`);
    if (n.lessons > 0) parts.push(`${n.lessons} lektion${n.lessons === 1 ? "" : "er"}`);
    if (n.reminded_times > 0) parts.push(`${n.reminded_times} påminnelse${n.reminded_times === 1 ? "" : "r"} skickade åt dig`);
    if (n.recovered_sum > 0) parts.push(`${money(n.recovered_sum, n.currency)} inbetalt efter påminnelser`);
    return parts.length ? `Det här finns redan i appen: ${parts.join(" · ")}.` : "";
  }
  if (n.students > 0) parts.push(`${n.students} student${n.students === 1 ? "" : "s"}`);
  if (n.lessons > 0) parts.push(`${n.lessons} lesson${n.lessons === 1 ? "" : "s"}`);
  if (n.reminded_times > 0) parts.push(`${n.reminded_times} reminder${n.reminded_times === 1 ? "" : "s"} sent for you`);
  if (n.recovered_sum > 0) parts.push(`${money(n.recovered_sum, n.currency)} collected after reminders`);
  return parts.length ? `Already in the app: ${parts.join(" · ")}.` : "";
}

/** Рядок «що назбиралось» для сплячих — лише з ненульових цифр. */
function pendingLine(lang: Lang, n: LifecycleNumbers): string {
  const parts: string[] = [];
  if (lang === "uk") {
    if (n.unmarked > 0) parts.push(`${n.unmarked} ${ukLessons(n.unmarked)} без відмітки «проведено»`);
    if (n.debt_lessons > 0) parts.push(`борг ${money(n.debt_sum, n.currency)} за ${n.debt_lessons} ${ukLessons(n.debt_lessons)}`);
    return parts.length ? `Назбиралось: ${parts.join(" · ")}.` : "Усе чисто — зайди глянути розклад на тиждень.";
  }
  if (lang === "sv") {
    if (n.unmarked > 0) parts.push(`${n.unmarked} lektion${n.unmarked === 1 ? "" : "er"} utan markering «genomförd»`);
    if (n.debt_lessons > 0) parts.push(`${money(n.debt_sum, n.currency)} obetalt för ${n.debt_lessons} lektion${n.debt_lessons === 1 ? "" : "er"}`);
    return parts.length ? `Väntar på dig: ${parts.join(" · ")}.` : "Allt är i ordning — titta in och se veckans schema.";
  }
  if (n.unmarked > 0) parts.push(`${n.unmarked} lesson${n.unmarked === 1 ? "" : "s"} not marked as done`);
  if (n.debt_lessons > 0) parts.push(`${money(n.debt_sum, n.currency)} unpaid for ${n.debt_lessons} lesson${n.debt_lessons === 1 ? "" : "s"}`);
  return parts.length ? `Waiting for you: ${parts.join(" · ")}.` : "All clear — drop in and check this week's schedule.";
}

export function lifecycleMessage(
  kind: LifecycleKind,
  lang: Lang,
  firstName: string,
  n: LifecycleNumbers,
  price: { monthly: number; yearly: number },
): LifecycleMessage {
  const name = (firstName || "").trim();
  const days = n.trial_days_left ?? 0;
  const proUk = `Pro — ${price.monthly} ₴/міс (або ${price.yearly} ₴/міс за рік): необмежено учнів, нагадування про оплату з реквізитами й кнопкою «Я оплатив(ла)», Telegram-дайджест щоранку.`;
  const proEn = `Pro — ${price.monthly} ₴/month (or ${price.yearly} ₴/month billed yearly): unlimited students, payment reminders with your bank details and an “I’ve paid” button, a Telegram digest every morning.`;
  const proSv = `Pro — ${price.monthly} ₴/mån (eller ${price.yearly} ₴/mån vid årsbetalning): obegränsat antal elever, betalningspåminnelser med dina bankuppgifter och en «Jag har betalat»-knapp, Telegram-sammanfattning varje morgon.`;

  if (lang === "uk") {
    const hi = name ? `${name}, ` : "";
    switch (kind) {
      case "welcome": return {
        title: `Привіт${name ? `, ${name}` : ""}! З чого почати в oTutorHub`,
        lines: [
          "Три кроки — і застосунок працює на тебе:",
          "1. Додай учня — або перенеси всіх одразу з Google Таблиці чи нотаток (ми розберемо самі).",
          "2. Постав урок — розклад і нагадування запрацюють без тебе.",
          "3. Познач оплату — борги й реквізити видно одним поглядом, а учню йде нагадування з кнопкою «Я оплатив(ла)».",
          "Якщо щось незручно — просто відповідай на цей лист: читаю кожен.",
        ],
        cta: { text: "Відкрити застосунок", path: "/" },
      };
      case "no_student_d1": return {
        title: `${hi}додай першого учня — це 20 секунд`,
        lines: [
          "Поки в застосунку немає учнів, йому нема про що нагадувати 🙂",
          "Маєш Google Таблицю чи список у нотатках? Встав — ми розберемо все самі: імена, предмети, ціни, борги.",
        ],
        cta: { text: "Додати учня", path: "/my-students?new=1" },
      };
      case "no_lesson_d3": return {
        title: `${hi}постав перший урок`,
        lines: [
          doneLine("uk", n),
          "Учень є — тепер урок. Після нього оплату можна позначити одним дотиком, а учню піде нагадування з реквізитами.",
        ].filter(Boolean),
        cta: { text: "Поставити урок", path: "/schedule?create=1" },
      };
      case "no_paid_d7": return {
        title: "Познач першу оплату — і побачиш головне",
        lines: [
          doneLine("uk", n),
          n.debt_lessons > 0
            ? `Неоплачених: ${n.debt_lessons} ${ukLessons(n.debt_lessons)} на ${money(n.debt_sum, n.currency)}. Натисни «Нагадати» — учень отримає реквізити й кнопку «Я оплатив(ла)», а ти підтвердиш одним дотиком.`
            : "Коли урок проведено — познач оплату або натисни «Нагадати»: учень отримає реквізити й кнопку «Я оплатив(ла)».",
        ].filter(Boolean),
        cta: { text: "Відкрити фінанси", path: "/finances" },
      };
      case "trial_7_left": return {
        title: `Тріал закінчується за ${days} ${ukDays(days)} — ось що вже зроблено`,
        lines: [doneLine("uk", n), proUk].filter(Boolean),
        cta: { text: "Продовжити з Pro", path: "/subscription" },
      };
      case "trial_2_left": return {
        title: `Залишилось ${days} ${ukDays(days)} тріалу`,
        lines: [
          doneLine("uk", n),
          "Учні, уроки й історія нікуди не зникнуть — але нові уроки й нагадування про оплату зупиняться.",
          proUk,
        ].filter(Boolean),
        cta: { text: "Увімкнути Pro", path: "/subscription" },
      };
      case "trial_ended": return {
        title: "Тріал закінчився — усе на місці",
        lines: [
          n.students > 0 || n.lessons > 0
            ? `Твої ${n.students} ${ukStudents(n.students)} і ${n.lessons} ${ukLessons(n.lessons)} збережені.`
            : "Усе, що ти вніс(ла), збережено.",
          "Щоб далі ставити уроки й нагадувати про оплату: " + proUk,
        ],
        cta: { text: "Увімкнути Pro", path: "/subscription" },
      };
      case "inactive_7": return {
        title: `${hi}за тиждень дещо назбиралось`,
        lines: [pendingLine("uk", n)],
        cta: { text: "Відкрити застосунок", path: "/" },
      };
      case "inactive_14": return {
        title: "Ми зберегли все, як було",
        lines: [
          pendingLine("uk", n),
          "Два тижні тиші — якщо щось не зайшло чи незручно, відповідай на цей лист одним рядком: це найкорисніше, що можна мені написати.",
        ],
        cta: { text: "Відкрити застосунок", path: "/" },
      };
    }
  }

  if (lang === "sv") {
    const hi = name ? `${name}, ` : "";
    switch (kind) {
      case "welcome": return {
        title: `Hej${name ? ` ${name}` : ""}! Så kommer du igång med oTutorHub`,
        lines: [
          "Tre steg — sedan jobbar appen åt dig:",
          "1. Lägg till en elev — eller flytta över alla på en gång från Google Kalkylark eller anteckningar.",
          "2. Lägg in en lektion — schema och påminnelser sköter sig själva.",
          "3. Markera en betalning — skulder och bankuppgifter syns direkt, och eleven får en påminnelse med knappen «Jag har betalat».",
          "Om något känns krångligt — svara bara på det här mejlet.",
        ],
        cta: { text: "Öppna appen", path: "/" },
      };
      case "no_student_d1": return {
        title: `${hi}lägg till din första elev — det tar 20 sekunder`,
        lines: ["Utan elever har appen inget att påminna om 🙂", "Har du ett Google Kalkylark eller en lista? Klistra in — vi reder ut namn, ämnen, priser och skulder."],
        cta: { text: "Lägg till elev", path: "/my-students?new=1" },
      };
      case "no_lesson_d3": return {
        title: `${hi}lägg in din första lektion`,
        lines: [doneLine("sv", n), "Eleven finns — nu en lektion. Efteråt markerar du betalningen med ett tryck, och eleven får en påminnelse med bankuppgifter."].filter(Boolean),
        cta: { text: "Lägg in lektion", path: "/schedule?create=1" },
      };
      case "no_paid_d7": return {
        title: "Markera din första betalning — och se det viktigaste",
        lines: [
          doneLine("sv", n),
          n.debt_lessons > 0
            ? `Obetalt: ${n.debt_lessons} lektion${n.debt_lessons === 1 ? "" : "er"}, ${money(n.debt_sum, n.currency)}. Tryck «Påminn» — eleven får bankuppgifter och knappen «Jag har betalat», du bekräftar med ett tryck.`
            : "När lektionen är genomförd — markera betalningen eller tryck «Påminn».",
        ].filter(Boolean),
        cta: { text: "Öppna ekonomi", path: "/finances" },
      };
      case "trial_7_left": return {
        title: `Provperioden slutar om ${days} dag${days === 1 ? "" : "ar"} — det här är gjort`,
        lines: [doneLine("sv", n), proSv].filter(Boolean),
        cta: { text: "Fortsätt med Pro", path: "/subscription" },
      };
      case "trial_2_left": return {
        title: `${days} dag${days === 1 ? "" : "ar"} kvar av provperioden`,
        lines: [doneLine("sv", n), "Elever, lektioner och historik försvinner inte — men nya lektioner och betalningspåminnelser pausas.", proSv].filter(Boolean),
        cta: { text: "Aktivera Pro", path: "/subscription" },
      };
      case "trial_ended": return {
        title: "Provperioden är slut — allt finns kvar",
        lines: [
          n.students > 0 || n.lessons > 0 ? `Dina ${n.students} elev${n.students === 1 ? "" : "er"} och ${n.lessons} lektion${n.lessons === 1 ? "" : "er"} är sparade.` : "Allt du lagt in är sparat.",
          "För att fortsätta lägga in lektioner och påminna om betalningar — " + proSv,
        ],
        cta: { text: "Aktivera Pro", path: "/subscription" },
      };
      case "inactive_7": return { title: `${hi}en del har samlats på en vecka`, lines: [pendingLine("sv", n)], cta: { text: "Öppna appen", path: "/" } };
      case "inactive_14": return {
        title: "Vi har sparat allt som det var",
        lines: [pendingLine("sv", n), "Två veckors tystnad — om något inte fungerade, svara på det här mejlet med en rad. Det är det mest värdefulla du kan skriva."],
        cta: { text: "Öppna appen", path: "/" },
      };
    }
  }

  const hi = name ? `${name}, ` : "";
  switch (kind) {
    case "welcome": return {
      title: `Hi${name ? ` ${name}` : ""}! Here’s how to start with oTutorHub`,
      lines: [
        "Three steps and the app works for you:",
        "1. Add a student — or move everyone at once from a Google Sheet or your notes (we sort it out).",
        "2. Schedule a lesson — the timetable and reminders run on their own.",
        "3. Mark a payment — debts and bank details at a glance, and the student gets a reminder with an “I’ve paid” button.",
        "If anything feels off — just reply to this email. I read every one.",
      ],
      cta: { text: "Open the app", path: "/" },
    };
    case "no_student_d1": return {
      title: `${hi}add your first student — it takes 20 seconds`,
      lines: ["Without students the app has nothing to remind about 🙂", "Got a Google Sheet or a list in your notes? Paste it — we’ll work out names, subjects, prices and debts."],
      cta: { text: "Add a student", path: "/my-students?new=1" },
    };
    case "no_lesson_d3": return {
      title: `${hi}schedule your first lesson`,
      lines: [doneLine("en", n), "You have a student — now a lesson. Afterwards you mark the payment with one tap, and the student gets a reminder with your bank details."].filter(Boolean),
      cta: { text: "Schedule a lesson", path: "/schedule?create=1" },
    };
    case "no_paid_d7": return {
      title: "Mark your first payment — and see what matters",
      lines: [
        doneLine("en", n),
        n.debt_lessons > 0
          ? `Unpaid: ${n.debt_lessons} lesson${n.debt_lessons === 1 ? "" : "s"}, ${money(n.debt_sum, n.currency)}. Tap “Remind” — the student gets your bank details and an “I’ve paid” button, you confirm with one tap.`
          : "Once a lesson is done — mark the payment or tap “Remind”.",
      ].filter(Boolean),
      cta: { text: "Open finances", path: "/finances" },
    };
    case "trial_7_left": return {
      title: `Your trial ends in ${days} day${days === 1 ? "" : "s"} — here’s what’s done`,
      lines: [doneLine("en", n), proEn].filter(Boolean),
      cta: { text: "Continue with Pro", path: "/subscription" },
    };
    case "trial_2_left": return {
      title: `${days} day${days === 1 ? "" : "s"} of trial left`,
      lines: [doneLine("en", n), "Students, lessons and history stay — but new lessons and payment reminders will pause.", proEn].filter(Boolean),
      cta: { text: "Turn on Pro", path: "/subscription" },
    };
    case "trial_ended": return {
      title: "Your trial has ended — everything is still here",
      lines: [
        n.students > 0 || n.lessons > 0 ? `Your ${n.students} student${n.students === 1 ? "" : "s"} and ${n.lessons} lesson${n.lessons === 1 ? "" : "s"} are saved.` : "Everything you entered is saved.",
        "To keep scheduling lessons and reminding about payments — " + proEn,
      ],
      cta: { text: "Turn on Pro", path: "/subscription" },
    };
    case "inactive_7": return { title: `${hi}a few things piled up this week`, lines: [pendingLine("en", n)], cta: { text: "Open the app", path: "/" } };
    case "inactive_14": return {
      title: "We kept everything as it was",
      lines: [pendingLine("en", n), "Two quiet weeks — if something didn’t work for you, reply to this email with one line. It’s the most useful thing you can send me."],
      cta: { text: "Open the app", path: "/" },
    };
  }
}

/** Telegram-текст: заголовок жирним, абзаци, кнопка-посилання окремим рядком. */
export function telegramText(m: LifecycleMessage, appUrl: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<b>${esc(m.title)}</b>\n\n${m.lines.map(esc).join("\n\n")}\n\n${esc(m.cta.text)}: ${appUrl}${m.cta.path}`;
}
