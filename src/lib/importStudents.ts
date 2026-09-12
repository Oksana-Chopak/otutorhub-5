/**
 * Імпорт «усе, що є» текстом (05.09 — учні; 07.09 — борги, передоплати,
 * розклад, контакти; рішення власниці: «мінімум клацань, в 1–2 кроки»).
 *
 * Парсер СВІДОМО детермінований, без AI: миттєво, офлайн, приватно (список
 * дітей з телефонами не літає в жодну модель), а помилки видно в превʼю до
 * створення. Фото зошита з AI-розбором — окремий етап (v2).
 *
 * 12.09 — ПЕРЕПИСАНО ПІСЛЯ ПРОВАЛУ НА ЛЕНДІНГУ. Власниця вставила свій
 * реальний список боргів — і «нічого не відбулось»: парсер розумів лише
 * канонічні хвости («борг 1200» після роздільника), а люди пишуть як у
 * нотатках: «Соня винна за 2 уроки», «Маша - 1200 грн», «Артем 1500»,
 * «Ігор — борг 800 грн за вересень», «Тарас 1200 (за 2 уроки)», «Даша не
 * оплатила вересень». Тепер:
 *   - імʼя відрізається від хвоста навіть без роздільника — на першій цифрі
 *     чи ключовому слові («винна», «борг», «не оплатила», «по», день тижня…);
 *   - борг/передоплата/ціна впізнаються ФРАЗАМИ будь-де в рядку, з
 *     прикметниками між числом і одиницею («3 неоплачені уроки»);
 *   - є ДВА РЕЖИМИ: «import» (застосунок; голе число = ціна уроку, як і
 *     раніше) і «debts» (лендінг «хто вам винен»; голе число = борг: гроші,
 *     якщо велике, уроки — якщо ≤ 30). Режим не вгадується — його задає
 *     екран, що знає, про що питав людину;
 *   - «не оплатила» без суми — теж борг (debtFlag), аби людина не зникла з
 *     дайджесту лише тому, що не написала цифру.
 *
 * Рядок = імʼя + будь-які хвости в будь-якому порядку (роздільники: — – - , ; | таб):
 *   «Марія Коваль — англійська — 600 — борг 1200 — пн 18:00»
 *   «Іван; математика; 500; передоплата 3»
 *   «Оля — 350 — вт,чт 16:30 — +380671234567 — mama@gmail.com»
 *   «Петро - фізика»                → без ціни
 *   «Соломія»                       → лише імʼя
 *   «Марк Іваненко 600»             → без роздільників: хвостове число = ціна
 * Усе нерозпізнане — у нотатку.
 *
 * Таблиця з Excel / Google Таблиць (табуляція + рядок заголовків) розбирається
 * по заголовках: імʼя, предмет, ціна, борг, передоплата, день, час, телефон,
 * пошта, telegram, нотатка — у будь-якому порядку.
 */

/**
 * Валюта імпорту v1 — гривня: імпорт запускається для українського ринку
 * (рішення власниці 05.09), а ставки пари в інших валютах правляться в
 * картці учня. Єдине місце, де це зашито.
 */
export const IMPORT_CURRENCY = "UAH";

export interface ScheduleSlot {
  /** 1 = понеділок … 7 = неділя (ISO). */
  weekday: number;
  /** "HH:MM" */
  time: string;
}

export type ImportWarning =
  | "debt_without_price"     // борг сумою без ставки — ляже однією позицією
  | "debt_lessons_need_price" // «борг 2 уроки» без ставки — не порахувати
  | "prepay_covers_debt"     // передоплата й борг одночасно — зводимо в нетто
  | "schedule_without_price"; // розклад є, ціни нема — уроки без ціни

export interface ParsedStudent {
  /** Оригінальний рядок — показуємо в превʼю при помилці. */
  raw: string;
  firstName: string;
  lastName: string;
  subject: string | null;
  price: number | null;
  /** Борг сумою (₴) — або кількістю уроків (тоді потрібна ставка). */
  debtAmount: number | null;
  debtLessons: number | null;
  /** «не оплатила», «винна» — борг є, суми людина не написала. */
  debtFlag: boolean;
  /** Передоплата: уроками або сумою. */
  prepayLessons: number | null;
  prepayAmount: number | null;
  schedule: ScheduleSlot[];
  durationMinutes: number | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  note: string | null;
  warnings: ImportWarning[];
  /** Людською мовою, чому рядок не буде імпортовано (null = ок). */
  error: "empty_name" | null;
}

/**
 * «import» — застосунок: голе число = ціна уроку.
 * «debts» — лендінг «хто вам винен»: голе число = борг (гроші або уроки).
 */
export type ParseMode = "import" | "debts";
export interface ParseOptions { mode?: ParseMode }

const SEPARATORS = /[—–;|\t]|(?:\s-\s)|,/g;

/**
 * Число з пробілом як роздільником тисяч: «1 200», «1 200,50», «1200».
 * Люди пишуть суми саме так (і Excel так копіює — з нерозривним пробілом).
 * Варіант з тисячами стоїть ПЕРШИМ, бо чергування в регексі впорядковане; він
 * вимагає рівно три цифри після пробілу, тому «борг 2 уроки» лишається уроками.
 */
const N = String.raw`\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?`;

/* ── Словник ──────────────────────────────────────────────────────────────── */
const W = String.raw`[a-zа-яіїєґёʼ'’]`; // «буква» — \b і \w не працюють з кирилицею в JS
const L = `${W}*`;                          // «хвіст слова»: борг|борги|боргу…
const LESSON_U = String.raw`(?:ур\.?|урок|уроки|уроків|уроку|занятт?я|занять|заняття|зан\.?|lessons?|l\.?|lektion(?:er)?|classes|class|sessions?)`;
const MONEY_U = String.raw`(?:грн\.?|гривень|гривні|гривня|₴|uah|kr|sek|€|eur|\$|usd)`;
const DEBT_KW = String.raw`(?:борг${L}|заборгован${L}|заборгува${L}|винен|винна|винні|винний|має заплатити|мають заплатити|не\s*(?:о|за|до)плат${L}|неоплач${L}|не\s*оплачен${L}|не\s*оплачено|не\s*заплачено|debts?|owes?|owed|owing|unpaid|skuld|obetald${L})`;
const PREPAY_KW = String.raw`(?:передоплат${L}|передплат${L}|аванс${L}|prepaid|prepayment|prepay|förskott|наперед|вперед|in advance)`;
const PAID_KW = String.raw`(?:оплатив|оплатила|оплатили|заплатив|заплатила|заплатили|оплачено|сплатив|сплатила|paid|betalat|betald)`;
const PRICE_KW = String.raw`(?:по|ціна|ставка|вартість|коштує|price|rate|pris)`;
const PER_KW = String.raw`(?:за|/|per)`;
// «may» / «maj» свідомо відсутні: Maj — шведське імʼя, May — англійське.
const MONTHS = String.raw`(?:січ${L}|лют${L}|берез${L}|квіт${L}|трав${L}|черв${L}|лип${L}|серп${L}|верес${L}|жовт${L}|листоп${L}|груд${L}|january|february|march|april|june|july|august|september|october|november|december|januari|februari|mars|juni|juli|augusti|oktober)`;

const num = (s: string): number => Number(s.replace(",", ".").replace(/[\s\u00a0\u202f]+/g, ""));
const isLessonUnit = (u: string) => new RegExp(`^${LESSON_U}$`, "i").test(u);
const isMoneyUnit = (u: string) => new RegExp(`^${MONEY_U}$`, "i").test(u);

const HEADER_WORDS = new Set([
  "імя", "ім'я", "имя", "name", "student", "students", "предмет", "subject", "ціна", "цена", "price", "rate",
  "ставка", "учень", "учні", "борг", "борги", "боржники", "debt", "debts", "передоплата", "prepaid", "prepay", "аванс", "день", "дні",
  "day", "weekday", "час", "time", "розклад", "schedule", "телефон", "phone", "пошта", "email", "e-mail",
  "telegram", "тг", "нотатка", "коментар", "note", "comment", "прізвище", "surname", "тривалість", "duration",
  "список", "оплати", "мої", "учнів", "хто", "винен", "винні", "кому", "скільки",
]);

const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(?:що)?(?:пн|пон|понеділок|понеділка|mon|monday|mån|måndag)$/i, 1],
  [/^(?:що)?(?:вт|вів|вівторок|вівторка|tue|tues|tuesday|tis|tisdag)$/i, 2],
  [/^(?:що)?(?:ср|сер|середа|середи|wed|wednesday|ons|onsdag)$/i, 3],
  [/^(?:що)?(?:чт|чет|четвер|четверга|thu|thur|thurs|thursday|tor|tors|torsdag)$/i, 4],
  [/^(?:що)?(?:пт|пʼятниця|п'ятниця|п’ятниця|пятниця|пʼятниці|п'ятниці|fri|friday|fre|fredag)$/i, 5],
  [/^(?:що)?(?:сб|суб|субота|суботи|sat|saturday|lör|lördag)$/i, 6],
  [/^(?:що)?(?:нд|нед|неділя|неділі|sun|sunday|sön|söndag)$/i, 7],
];
const TIME_RE = /^(?:о\s*|at\s*|kl\.?\s*)?([01]?\d|2[0-3])(?:[:.\-h]([0-5]\d))?$/i;
const WEEKDAY_WORD = "(?:що)?(?:пн|пон|понеділок|понеділка|вт|вів|вівторок|вівторка|ср|сер|середа|середи|чт|чет|четвер|четверга|пт|пʼятниця|п'ятниця|п’ятниця|пятниця|пʼятниці|п'ятниці|сб|суб|субота|суботи|нд|нед|неділя|неділі|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday|mån|måndag|tis|tisdag|ons|onsdag|tor|tors|torsdag|fre|fredag|lör|lördag|sön|söndag)";
// «вт,чт 16:30» — кома між днями тижня НЕ роздільник полів: склеюємо плюсом до
// розбиття рядка, щоб дні лишились в одному токені.
const DAY_COMMA_RE = new RegExp(`(${WEEKDAY_WORD})\\s*,\\s*(?=${WEEKDAY_WORD}(?![a-zа-яіїєґ]))`, "gi");
/** Розклад як фраза всередині довшого хвоста: «пн і ср о 17», «вт+чт 16:30». */
const SCHEDULE_PHRASE_RE = new RegExp(
  `(?<![a-zа-яіїєґ])(${WEEKDAY_WORD}(?:\\s*(?:\\+|/|&|\\sі\\s|\\sта\\s|\\sand\\s|\\soch\\s)\\s*${WEEKDAY_WORD})*)\\s*(?:о|в|у|at|kl\\.?)?\\s*((?:[01]?\\d|2[0-3])(?:[:.h\\-][0-5]\\d)?)(?![\\d:])`,
  "i",
);

/** Слова, на яких закінчується імʼя, якщо роздільника нема. */
const NAME_STOP_RE = new RegExp(
  `^(?:${DEBT_KW}|${PREPAY_KW}|${PAID_KW}|${PRICE_KW}|${LESSON_U}|${MONEY_U}|${MONTHS}|не|за|зі|з|у|в|на|о|про|ще|вже|і|та|and|owes?|owe|paid|pays|debt|price|per|at|on|for|has|hasn't|didn't|сьогодні|завтра|щодня|щотижня|min|хв|хвилин)$`,
  "i",
);
const WEEKDAY_ONLY_RE = new RegExp(`^${WEEKDAY_WORD}$`, "i");
/** Поширені предмети — щоб «Максим англійська 500» без роздільників теж читалось. */
const SUBJECT_WORD_RE = /^(?:математик[a-zа-яіїєґёʼ'’]*|алгебр[a-zа-яіїєґёʼ'’]*|геометрі[a-zа-яіїєґёʼ'’]*|англійськ[a-zа-яіїєґёʼ'’]*|англ\.?|німецьк[a-zа-яіїєґёʼ'’]*|французьк[a-zа-яіїєґёʼ'’]*|іспанськ[a-zа-яіїєґёʼ'’]*|італійськ[a-zа-яіїєґёʼ'’]*|польськ[a-zа-яіїєґёʼ'’]*|українськ[a-zа-яіїєґёʼ'’]*|укр\.?|фізик[a-zа-яіїєґёʼ'’]*|хімі[a-zа-яіїєґёʼ'’]*|біологі[a-zа-яіїєґёʼ'’]*|історі[a-zа-яіїєґёʼ'’]*|географі[a-zа-яіїєґёʼ'’]*|інформатик[a-zа-яіїєґёʼ'’]*|програмуванн[a-zа-яіїєґёʼ'’]*|літератур[a-zа-яіїєґёʼ'’]*|музик[a-zа-яіїєґёʼ'’]*|вокал[a-zа-яіїєґёʼ'’]*|гітар[a-zа-яіїєґёʼ'’]*|фортепіано|піаніно|малюванн[a-zа-яіїєґёʼ'’]*|шах[a-zа-яіїєґёʼ'’]*|зно|нмт|дпа|english|math|maths|physics|chemistry|biology|history|german|french|spanish|swedish|svenska|engelska|matte|matematik|fysik|kemi)$/i;

function looksLikeHeader(line: string): boolean {
  // Апострофи бувають різні (' ʼ ’ `) — «Імʼя» в заголовку має ловитись усіма.
  const words = line
    .toLowerCase()
    .replace(/['ʼ’`]/g, "")
    .replace(/[^a-zа-яіїєґ\- ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.every((w) => HEADER_WORDS.has(w))) return true;
  // «Борги за вересень:» / «Мої учні:» — підпис розділу, а не учень.
  return /:\s*$/.test(line) && !/\d/.test(line) && words.length <= 4 && words.some((w) => HEADER_WORDS.has(w));
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  // Перше слово — імʼя, решта — прізвище (по-батькові теж туди: краще в
  // прізвищі, ніж загублене).
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Імʼя без роздільника: «Соня винна за 2 уроки» → «Соня» + «винна за 2 уроки»,
 * «Артем 1500» → «Артем» + «1500», «Марта: 1200» → «Марта» + «1200».
 * Імʼя — до чотирьох слів (імʼя, прізвище, по батькові), що не є числом,
 * ключовим словом чи предметом.
 */
function cutName(candidate: string): { name: string; rest: string } {
  const c = candidate.trim();
  const colon = c.indexOf(":");
  if (colon > 0 && !/^\d/.test(c) && !/\d:\d/.test(c)) {
    return { name: c.slice(0, colon).trim(), rest: c.slice(colon + 1).trim() };
  }
  const words = c.split(/\s+/);
  const nameWords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const bare = w.replace(/[()[\]«»"“”.]/g, "");
    // День тижня — стоп лише коли за ним час або ще один день: «Tor» і «Sun» —
    // теж імена, а «Оля пн 18:00» — розклад.
    const next = (words[i + 1] ?? "").replace(/[()[\]«»"“”.]/g, "");
    const weekdayStart = WEEKDAY_ONLY_RE.test(bare) && (TIME_RE.test(next) || WEEKDAY_ONLY_RE.test(next) || /^(?:о|в|у|at|kl\.?)$/i.test(next));
    if (!bare || /^\d/.test(bare) || /^[+@]/.test(bare) || NAME_STOP_RE.test(bare) || SUBJECT_WORD_RE.test(bare) || weekdayStart || nameWords.length >= 4) {
      return { name: nameWords.join(" "), rest: words.slice(i).join(" ") };
    }
    nameWords.push(w);
  }
  return { name: nameWords.join(" "), rest: "" };
}

/** «пн 18:00», «вт та чт 16:30», «щопн о 18», «mon 17» → слоти (весь токен). */
function parseSchedule(tok: string): ScheduleSlot[] | null {
  const words = tok
    .replace(/[,/&+]|\s(?:і|та|and|och)\s/gi, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && !/^(?:о|в|у|at|kl\.?)$/i.test(w));
  const days: number[] = [];
  let time: string | null = null;
  for (const w of words) {
    const wd = WEEKDAYS.find(([re]) => re.test(w));
    if (wd) { days.push(wd[1]); continue; }
    const tm = TIME_RE.exec(w);
    if (tm && days.length > 0 && time === null) {
      time = `${tm[1].padStart(2, "0")}:${tm[2] ?? "00"}`;
      continue;
    }
    return null; // стороннє слово — це не розклад
  }
  if (days.length === 0 || time === null) return null;
  return Array.from(new Set(days)).map((weekday) => ({ weekday, time: time as string }));
}

/** Число + (можливо прикметник) + одиниця: «3 неоплачені уроки», «2 уроки», «800 грн». */
const NUM_UNIT_RE = new RegExp(String.raw`(${N})\s*(?:(?:${W}+)\s+){0,2}?(${LESSON_U}|${MONEY_U})(?!${W})`, "i");
const PLAIN_NUM_RE = new RegExp(String.raw`^\s*(${N})\s*(${MONEY_U}|${LESSON_U})?\s*$`, "i");

interface Money { amount?: number; lessons?: number }

function unitValue(n: number, unit: string | undefined, fallback: "amount" | "lessons" | "auto"): Money {
  const u = (unit ?? "").trim();
  if (u && isLessonUnit(u)) return { lessons: Math.round(n) };
  if (u && isMoneyUnit(u)) return { amount: n };
  if (fallback === "auto") return n <= 30 && Number.isInteger(n) ? { lessons: n } : { amount: n };
  return fallback === "amount" ? { amount: n } : { lessons: Math.round(n) };
}

/**
 * Розбір одного хвоста (усе після імені між роздільниками). Повертає, що
 * впізнав, і залишок для нотатки. Порядок важливий: контакти → розклад →
 * тривалість → ціна → передоплата → борг → голі числа → слова.
 */
interface Tail {
  price?: number; debt?: Money; debtFlag?: boolean; prepay?: Money;
  /** «2 уроки — 800»: сума без слова після боргу уроками = підсумок; уроки — в нотатку. */
  replaceLessons?: boolean;
  schedule?: ScheduleSlot[]; duration?: number; phone?: string; email?: string; telegram?: string;
  words: string;
}

function parseTail(tokRaw: string, mode: ParseMode, ctx: { price: number | null; debt: Money | null }): Tail {
  const out: Tail = { words: "" };
  let s = tokRaw.replace(/[()[\]«»"“”]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return out;

  // Контакти — цілим токеном, як і раніше (телефон із пробілами не має ставати сумою).
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { out.email = s.toLowerCase(); return out; }
  if (/^@[a-z0-9_]{4,}$/i.test(s)) { out.telegram = s; return out; }
  if (/^\+?[\d\s()-]{9,}$/.test(s) && s.replace(/\D/g, "").length >= 9) { out.phone = s.replace(/[\s()-]/g, ""); return out; }

  // Розклад — цілим токеном або фразою всередині.
  const whole = parseSchedule(s);
  if (whole) { out.schedule = whole; return out; }
  const sp = SCHEDULE_PHRASE_RE.exec(s);
  if (sp) {
    const sl = parseSchedule(`${sp[1].replace(/\s*(?:\+|\/|&|\sі\s|\sта\s|\sand\s|\soch\s)\s*/gi, " ")} ${sp[2]}`);
    if (sl) { out.schedule = sl; s = (s.slice(0, sp.index) + " " + s.slice(sp.index + sp[0].length)).replace(/\s+/g, " ").trim(); }
  }

  const dm = new RegExp(String.raw`(?<!\d)(\d{2,3})\s*(?:хв|хвилин|min|minutes?)(?!${W})`, "i").exec(s);
  if (dm) { out.duration = Number(dm[1]); s = (s.slice(0, dm.index) + " " + s.slice(dm.index + dm[0].length)).trim(); }

  // Ціна: «по 400», «ціна 500», «500/урок», «500 грн за урок», «500 за заняття».
  const priceA = new RegExp(String.raw`(?<!${W})${PRICE_KW}\s*:?\s*(${N})\s*(?:${MONEY_U})?(?:\s*${PER_KW}\s*(?:${LESSON_U}|годин${L}|год\.?|hour|h|timme))?(?!${W})`, "i").exec(s);
  const priceB = new RegExp(String.raw`(?<![\d.,])(${N})\s*(?:${MONEY_U})?\s*${PER_KW}\s*(?:${LESSON_U}|годин${L}|год\.?|hour|h|timme)(?!${W})`, "i").exec(s);
  const pm = priceA ?? priceB;
  if (pm) {
    const n = num(pm[1]);
    if (Number.isFinite(n) && n > 0) { out.price = n; s = (s.slice(0, pm.index) + " " + s.slice(pm.index + pm[0].length)).replace(/\s+/g, " ").trim(); }
  }

  // Борг: «борг 1200», «винна за 2 уроки», «заборгувала 3 заняття», «не оплатила
  // 2 уроки», «3 неоплачені уроки», «2 уроки не оплачено», «винен» (без суми).
  const debtA = new RegExp(String.raw`(?<!${W})(${DEBT_KW})\s*:?\s*(?:(?:за|мені|ще|уже|вже|з|у|в)\s+){0,3}(${N})\s*(?:(?:${W}+)\s+){0,2}?(${LESSON_U}|${MONEY_U})?(?!${W})`, "i").exec(s);
  const debtB = new RegExp(String.raw`(?<![\d.,])(${N})\s*(?:(?:${W}+)\s+){0,2}?(${LESSON_U}|${MONEY_U})\s*(?:(?:${W}+)\s+){0,2}?(${DEBT_KW})(?!${W})`, "i").exec(s);
  const debtC = new RegExp(String.raw`(?<![\d.,])(${N})\s+(${DEBT_KW})\s+(${LESSON_U}|${MONEY_U})(?!${W})`, "i").exec(s);
  if (debtA) {
    const n = num(debtA[2]);
    if (Number.isFinite(n) && n > 0) {
      const verb = /^(?:винен|винна|винні|винний|заборгува|не)/i.test(debtA[1]);
      // «борг 3» — гроші (канон імпорту); «винна 3» / «заборгувала 3» — уроки.
      out.debt = unitValue(n, debtA[3], verb ? "auto" : "amount");
      s = (s.slice(0, debtA.index) + " " + s.slice(debtA.index + debtA[0].length)).replace(/\s+/g, " ").trim();
    }
  } else if (debtB || debtC) {
    const m = (debtB ?? debtC) as RegExpExecArray;
    const n = num(m[1]);
    const unit = debtB ? debtB[2] : (debtC as RegExpExecArray)[3];
    if (Number.isFinite(n) && n > 0) {
      out.debt = unitValue(n, unit, "amount");
      s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
    }
  } else {
    const flag = new RegExp(String.raw`(?<!${W})${DEBT_KW}(?!${W})`, "i").exec(s);
    if (flag) { out.debtFlag = true; s = (s.slice(0, flag.index) + " " + s.slice(flag.index + flag[0].length)).replace(/\s+/g, " ").trim(); }
  }

  // Передоплата: «передоплата 3», «аванс 1500 грн», «оплатила наперед 5 уроків»,
  // «оплатив 2000 наперед», «5 уроків наперед».
  const prepA = new RegExp(String.raw`(?<!${W})${PREPAY_KW}\s*:?\s*(?:за\s*)?(${N})\s*(?:(?:${W}+)\s+){0,2}?(${LESSON_U}|${MONEY_U})?(?!${W})`, "i").exec(s);
  // «оплатила 5 уроків» — передоплата; «НЕ оплатила 5 уроків» — борг (уже знято вище), тому «не» перед дієсловом заборонене.
  const prepB = new RegExp(String.raw`(?<!${W})(?<!не\s)(?<!не\s\s)${PAID_KW}\s+(?:${PREPAY_KW}\s+)?(?:за\s+)?(${N})\s*(${LESSON_U}|${MONEY_U})?(?:\s*${PREPAY_KW})?(?!${W})`, "i").exec(s);
  const prepC = new RegExp(String.raw`(?<![\d.,])(${N})\s*(${LESSON_U}|${MONEY_U})?\s*${PREPAY_KW}(?!${W})`, "i").exec(s);
  const pp = prepA ?? prepB ?? prepC;
  if (pp) {
    const n = num(pp[1]);
    if (Number.isFinite(n) && n > 0) {
      out.prepay = unitValue(n, pp[2], "auto");
      s = (s.slice(0, pp.index) + " " + s.slice(pp.index + pp[0].length)).replace(/\s+/g, " ").trim();
    }
  }

  // Число, що лишилось: саме по собі («1500», «2 уроки», «800 грн») або в
  // суміші зі словами («англійська 500», «1200 за 2 уроки»). Час «18:00» — не число.
  const takeNumber = (n: number, unit: string | undefined): boolean => {
    if (!Number.isFinite(n) || n <= 0) return false;
    if (unit && isLessonUnit(unit)) {
      // «2 уроки» без слова: на лендінгу — борг уроками; в імпорті — нотатка.
      if (mode === "debts" && !out.debt && !ctx.debt) { out.debt = { lessons: Math.round(n) }; return true; }
      return false;
    }
    if (mode === "debts") {
      if (out.price !== undefined || ctx.price !== null) return false;
      // «Артем 1500», «Маша 1200 грн» у списку «хто винен» — це борг.
      if (!out.debt && !ctx.debt) { out.debt = unitValue(n, unit, "auto"); return true; }
      // Борг уроками вже названо, тепер сума без слова — це підсумок («2 уроки — 800»),
      // а не ставка: занижена помилка краща за подвоєну.
      if (!out.debt && ctx.debt?.lessons && !ctx.debt.amount) { out.debt = { amount: n }; out.replaceLessons = true; return true; }
      return false;
    }
    if (ctx.price === null && out.price === undefined) { out.price = n; return true; }
    return false;
  };
  const plain = PLAIN_NUM_RE.exec(s);
  if (plain) {
    if (takeNumber(num(plain[1]), plain[2])) return out;
    out.words = s; return out;
  }
  const mixed = new RegExp(String.raw`(?<![\d.,:])(${N})\s*(${MONEY_U}|${LESSON_U})?(?![\d:])`, "i").exec(s);
  if (mixed && (mixed[2] || mixed[1].replace(/\D/g, "").length >= 2) && takeNumber(num(mixed[1]), mixed[2])) {
    s = (s.slice(0, mixed.index) + " " + s.slice(mixed.index + mixed[0].length)).replace(/\s+/g, " ").trim();
  }
  // «за 2 уроки» після суми / «за вересень» — контекст, іде в нотатку.
  out.words = s.replace(/^\s*(?:за|for)\s+/i, "").trim();
  return out;
}

export function parseStudentLine(rawLine: string, opts: ParseOptions = {}): ParsedStudent | null {
  const mode: ParseMode = opts.mode ?? "import";
  const raw = rawLine.trim();
  if (!raw) return null;
  if (looksLikeHeader(raw)) return null;

  // Нумерація списку («1. Марія», «2) Іван», «- Марія», «• Марія») — зрізаємо;
  // дні тижня через кому — склеюємо.
  const line = raw.replace(/^\s*(?:\d{1,3}\s*[.)]|[-•*–—])\s*/, "").replace(DAY_COMMA_RE, "$1+");

  const tokens = line
    .split(SEPARATORS)
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const { name, rest } = cutName(tokens[0]);
  const tails = [rest, ...tokens.slice(1)].filter((t) => t.length > 0);

  let subject: string | null = null;
  let price: number | null = null;
  let debtAmount: number | null = null;
  let debtLessons: number | null = null;
  let debtFlag = false;
  let prepayLessons: number | null = null;
  let prepayAmount: number | null = null;
  let durationMinutes: number | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let telegram: string | null = null;
  const schedule: ScheduleSlot[] = [];
  const noteParts: string[] = [];
  let debtLessonsRaw: string | null = null;

  // Кожен хвіст — окремо; контекст (уже знайдена ціна/борг) передається далі,
  // бо «Артем 1500» і «Аня — 2 уроки — 800» читаються різно залежно від того,
  // що вже відомо. «Марк Іваненко 600» без роздільників іде тим самим шляхом.
  for (const tail of tails) {
    const t = parseTail(tail, mode, { price, debt: debtAmount !== null || debtLessons !== null ? { amount: debtAmount ?? undefined, lessons: debtLessons ?? undefined } : null });
    if (t.email && email === null) email = t.email;
    if (t.telegram && telegram === null) telegram = t.telegram;
    if (t.phone && phone === null) phone = t.phone;
    if (t.schedule) schedule.push(...t.schedule);
    if (t.duration && durationMinutes === null) durationMinutes = t.duration;
    if (t.price !== undefined && price === null) price = t.price;
    if (t.prepay) {
      if (t.prepay.lessons) prepayLessons = (prepayLessons ?? 0) + t.prepay.lessons;
      else if (t.prepay.amount) prepayAmount = (prepayAmount ?? 0) + t.prepay.amount;
    }
    if (t.debt) {
      if (t.replaceLessons && debtLessonsRaw) { noteParts.push(debtLessonsRaw); debtLessons = null; }
      if (t.debt.lessons) { debtLessons = (debtLessons ?? 0) + t.debt.lessons; debtLessonsRaw = tail.trim(); }
      else if (t.debt.amount) debtAmount = (debtAmount ?? 0) + t.debt.amount;
    }
    if (t.debtFlag) debtFlag = true;
    const words = t.words.replace(/^[\s:.\-–—]+|[\s:.\-–—]+$/g, "");
    if (!words) continue;
    // Предмет — коротке слово/два без цифр і без службових слів; довше або з
    // цифрами — нотатка («мама платить 1 числа» не має стати предметом).
    const isMonth = new RegExp(`^${MONTHS}$`, "i");
    const wl = words.split(/\s+/);
    const serviceWord = wl.some((w) => NAME_STOP_RE.test(w) || isMonth.test(w));
    if (subject === null && !/\d/.test(words) && wl.length <= 3 && words.length <= 40 && !serviceWord) { subject = words; continue; }
    noteParts.push(words);
  }

  const { firstName, lastName } = splitName(name);
  const okPrice = price !== null && Number.isFinite(price) && price > 0 ? price : null;
  const warnings: ImportWarning[] = [];
  if (debtLessons !== null && okPrice === null) warnings.push("debt_lessons_need_price");
  else if (debtAmount !== null && okPrice === null) warnings.push("debt_without_price");
  if ((debtAmount !== null || debtLessons !== null) && (prepayLessons !== null || prepayAmount !== null)) warnings.push("prepay_covers_debt");
  if (schedule.length > 0 && okPrice === null) warnings.push("schedule_without_price");

  return {
    raw,
    firstName,
    lastName,
    subject,
    price: okPrice,
    debtAmount,
    debtLessons,
    debtFlag: debtFlag && debtAmount === null && debtLessons === null,
    prepayLessons,
    prepayAmount,
    schedule,
    durationMinutes,
    phone,
    email,
    telegram,
    note: noteParts.length ? noteParts.join(" · ") : null,
    warnings,
    error: firstName ? null : "empty_name",
  };
}

// ── Таблиця з Excel / Google Таблиць ──────────────────────────────────────────
type Col = "name" | "surname" | "subject" | "price" | "debt" | "prepay" | "day" | "time" | "schedule" | "phone" | "email" | "telegram" | "note" | "duration" | null;

function headerCol(h: string): Col {
  const w = h.toLowerCase().replace(/['ʼ’`]/g, "").trim();
  if (/^(імя|имя|name|student|учень|учні|ім'я|full name|піб)$/.test(w)) return "name";
  if (/^(прізвище|surname|last name)$/.test(w)) return "surname";
  if (/^(предмет|subject|ämne)$/.test(w)) return "subject";
  if (/^(ціна|цена|price|rate|ставка|вартість|pris)$/.test(w)) return "price";
  if (/^(борг|debt|заборгованість|skuld)$/.test(w)) return "debt";
  if (/^(передоплата|передплата|аванс|prepaid|prepay|prepayment|förskott)$/.test(w)) return "prepay";
  if (/^(день|дні|день тижня|day|weekday|дн)$/.test(w)) return "day";
  if (/^(час|time|tid)$/.test(w)) return "time";
  if (/^(розклад|schedule|schema)$/.test(w)) return "schedule";
  if (/^(телефон|phone|тел|mobile|телефон батьків)$/.test(w)) return "phone";
  if (/^(пошта|email|e-mail|mail|epost|e-post)$/.test(w)) return "email";
  if (/^(telegram|тг|телеграм)$/.test(w)) return "telegram";
  if (/^(нотатка|коментар|note|notes|comment|примітка)$/.test(w)) return "note";
  if (/^(тривалість|duration|хв)$/.test(w)) return "duration";
  return null;
}

function looksLikeTable(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  const first = lines[0].split("\t");
  if (first.length < 2) return false;
  const cols = first.map(headerCol);
  return cols.some((c) => c === "name") && cols.filter(Boolean).length >= 2;
}

function tableToLines(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = lines[0].split("\t").map(headerCol);
  const out: string[] = [];
  for (const row of lines.slice(1)) {
    const cells = row.split("\t").map((c) => c.trim());
    const get = (c: Col) => cols.map((k, i) => (k === c ? cells[i] ?? "" : "")).filter(Boolean).join(" ").trim();
    const name = [get("name"), get("surname")].filter(Boolean).join(" ");
    if (!name) continue;
    const parts: string[] = [name];
    const subj = get("subject"); if (subj) parts.push(subj);
    const price = get("price"); if (price) parts.push(price);
    const debt = get("debt"); if (debt) parts.push(/^\d/.test(debt) ? `борг ${debt}` : debt);
    const prepay = get("prepay"); if (prepay) parts.push(/^\d/.test(prepay) ? `передоплата ${prepay}` : prepay);
    const sched = get("schedule"); const day = get("day"); const time = get("time");
    if (sched) parts.push(sched);
    else if (day && time) parts.push(`${day} ${time}`);
    const dur = get("duration"); if (dur) parts.push(/хв|min/i.test(dur) ? dur : `${dur} хв`);
    const phone = get("phone"); if (phone) parts.push(phone);
    const email = get("email"); if (email) parts.push(email);
    const tg = get("telegram"); if (tg) parts.push(tg.startsWith("@") ? tg : `@${tg}`);
    const note = get("note"); if (note) parts.push(note);
    out.push(parts.join(" — "));
  }
  return out;
}

export function parseStudentList(text: string, opts: ParseOptions = {}): ParsedStudent[] {
  // Таблиця з заголовками — завжди канон імпорту (голе число в колонці «ціна» — ціна).
  const table = looksLikeTable(text);
  const lines = table ? tableToLines(text) : text.split(/\r?\n/);
  const mode: ParseMode = table ? "import" : (opts.mode ?? "import");
  return lines
    .map((l) => parseStudentLine(l, { mode }))
    .filter((r): r is ParsedStudent => r !== null);
}

// ── Канонічний рядок: те, що розібрано, — назад у текст імпорту ─────────────

/** Слова для канонічного рядка — локалізовані, бо їх бачить людина в імпорті. */
export interface CanonicalWords {
  debt: string;    // «борг»
  prepay: string;  // «передоплата»
  lessons: string; // «уроки»
  money: string;   // «грн»
  min: string;     // «хв»
  day: (weekday: number) => string; // 1 → «пн»
}

/**
 * Лендінг читає список У РЕЖИМІ «debts» («Артем 1500» = борг), а імпорт у
 * застосунку — в режимі «import» («Артем 1500» = ціна). Щоб число після
 * реєстрації ДОРІВНЮВАЛО числу на лендінгу, естафеті передається не сирий
 * текст, а канонічні рядки, які обидва режими читають однаково.
 */
export function toCanonicalLine(r: ParsedStudent, w: CanonicalWords): string | null {
  if (r.error || !r.firstName) return null;
  const parts: string[] = [[r.firstName, r.lastName].filter(Boolean).join(" ")];
  if (r.subject) parts.push(r.subject);
  if (r.price && r.price > 0) parts.push(String(r.price));
  if (r.debtAmount && r.debtAmount > 0) parts.push(`${w.debt} ${r.debtAmount} ${w.money}`);
  if (r.debtLessons && r.debtLessons > 0) parts.push(`${w.debt} ${r.debtLessons} ${w.lessons}`);
  if (r.prepayAmount && r.prepayAmount > 0) parts.push(`${w.prepay} ${r.prepayAmount} ${w.money}`);
  if (r.prepayLessons && r.prepayLessons > 0) parts.push(`${w.prepay} ${r.prepayLessons} ${w.lessons}`);
  // Дні з однаковим часом — одним хвостом: «вт,чт 16:30».
  const byTime = new Map<string, number[]>();
  for (const s of r.schedule) byTime.set(s.time, [...(byTime.get(s.time) ?? []), s.weekday]);
  for (const [time, days] of byTime) parts.push(`${[...new Set(days)].sort((a, b) => a - b).map(w.day).join(",")} ${time}`);
  if (r.durationMinutes) parts.push(`${r.durationMinutes} ${w.min}`);
  if (r.phone) parts.push(r.phone);
  if (r.email) parts.push(r.email);
  if (r.telegram) parts.push(r.telegram);
  const note = [r.debtFlag ? w.debt : null, r.note].filter(Boolean).join(" · ");
  if (note) parts.push(note);
  return parts.join(" — ");
}

export function toCanonicalText(rows: ParsedStudent[], w: CanonicalWords): string {
  return rows.map((r) => toCanonicalLine(r, w)).filter((l): l is string => !!l).join("\n");
}

// ── Нетто борг/передоплата та дати уроків — рахує клієнт ─────────────────────

export interface ImportPayload {
  debtAmount: number;
  debtLessons: number;
  prepayLessons: number;
  prepayAmount: number;
}

/**
 * Горизонт розкладу імпорту = 4 тижні. Живе ТУТ, а не в компоненті, бо на це
 * число спирається і лендінговий калькулятор: два екрани — одна константа.
 */
export const IMPORT_SCHEDULE_WEEKS = 4;

/**
 * Борг і передоплата одного учня зводяться в нетто ДО запису — інакше
 * гаманець одразу погасив би те, що ми щойно створили. Різні одиниці
 * (уроки vs гроші) зводяться через ставку; без ставки — лишаються як є.
 */
export function netDebtAndPrepay(r: ParsedStudent): ImportPayload {
  let debtAmount = r.debtAmount ?? 0;
  let debtLessons = r.debtLessons ?? 0;
  let prepayLessons = r.prepayLessons ?? 0;
  let prepayAmount = r.prepayAmount ?? 0;
  const price = r.price ?? 0;
  // Приводимо до однієї одиниці, якщо є ставка.
  if (price > 0) {
    if (debtLessons > 0) { debtAmount += debtLessons * price; debtLessons = 0; }
    if (prepayLessons > 0 && debtAmount > 0) { prepayAmount += prepayLessons * price; prepayLessons = 0; }
  }
  if (debtAmount > 0 && prepayAmount > 0) {
    const net = debtAmount - prepayAmount;
    debtAmount = Math.max(0, net);
    prepayAmount = Math.max(0, -net);
  }
  if (debtLessons > 0 && prepayLessons > 0) {
    const net = debtLessons - prepayLessons;
    debtLessons = Math.max(0, net);
    prepayLessons = Math.max(0, -net);
  }
  return { debtAmount, debtLessons, prepayLessons, prepayAmount };
}

/** Дати уроків на N тижнів уперед від найближчого входження (локальний час). */
export function scheduleToStarts(slots: ScheduleSlot[], weeks: number, now: Date = new Date()): Date[] {
  const out: Date[] = [];
  for (const s of slots) {
    const [hh, mm] = s.time.split(":").map(Number);
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setHours(hh, mm, 0, 0);
    // ISO weekday: JS getDay() 0=нд → 7
    const jsDay = d.getDay() === 0 ? 7 : d.getDay();
    let delta = (s.weekday - jsDay + 7) % 7;
    if (delta === 0 && d.getTime() <= now.getTime()) delta = 7;
    d.setDate(d.getDate() + delta);
    for (let i = 0; i < weeks; i++) {
      out.push(new Date(d.getTime() + i * 7 * 86400000));
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
