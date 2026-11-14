// Час для КОНКРЕТНОЇ людини (14.11, питання власниці: «я в Стокгольмі, репетитор у Києві,
// учень у Берліні»).
//
// До 14.11 кожне серверне повідомлення — нагадування про урок і про оплату, дайджести, штраф за
// скасування — писало час за `Europe/Kyiv` і не казало цього. Учень у Берліні читав «о 16:00» як
// свої 16:00, а в застосунку той самий урок у нього стояв на 15:00.
//
// Тепер: пояс людини лежить у `profiles.timezone` (застосунок пише його сам при вході). Час у
// повідомленні форматується за поясом ТОГО, ХТО ЙОГО ЧИТАЄ, і поруч стоїть, який це пояс:
// «16 листопада о 15:00 (Берлін, GMT+1)». Пояс невідомий (людина ще не заходила, або це
// запрошений профіль без акаунта) → київський час, і теж із позначкою.
//
// Назви міст — та сама таблиця, що `timeZone.cities` у застосунку (edge не може імпортувати src/);
// стереже `person-timezone-edge.test.ts`.
// deno-lint-ignore-file no-explicit-any

export const DEFAULT_TZ = "Europe/Kyiv";
export type TzLang = "uk" | "en" | "sv";

const CITY: Record<string, Record<TzLang, string>> = {
  Kyiv: { uk: "Київ", en: "Kyiv", sv: "Kyiv" },
  Stockholm: { uk: "Стокгольм", en: "Stockholm", sv: "Stockholm" },
  Berlin: { uk: "Берлін", en: "Berlin", sv: "Berlin" },
  Warsaw: { uk: "Варшава", en: "Warsaw", sv: "Warszawa" },
  London: { uk: "Лондон", en: "London", sv: "London" },
  Prague: { uk: "Прага", en: "Prague", sv: "Prag" },
  Vienna: { uk: "Відень", en: "Vienna", sv: "Wien" },
  Paris: { uk: "Париж", en: "Paris", sv: "Paris" },
  Madrid: { uk: "Мадрид", en: "Madrid", sv: "Madrid" },
  Rome: { uk: "Рим", en: "Rome", sv: "Rom" },
  Amsterdam: { uk: "Амстердам", en: "Amsterdam", sv: "Amsterdam" },
  Brussels: { uk: "Брюссель", en: "Brussels", sv: "Bryssel" },
  Zurich: { uk: "Цюрих", en: "Zurich", sv: "Zürich" },
  Lisbon: { uk: "Лісабон", en: "Lisbon", sv: "Lissabon" },
  Dublin: { uk: "Дублін", en: "Dublin", sv: "Dublin" },
  Helsinki: { uk: "Гельсінкі", en: "Helsinki", sv: "Helsingfors" },
  Oslo: { uk: "Осло", en: "Oslo", sv: "Oslo" },
  Copenhagen: { uk: "Копенгаген", en: "Copenhagen", sv: "Köpenhamn" },
  Vilnius: { uk: "Вільнюс", en: "Vilnius", sv: "Vilnius" },
  Riga: { uk: "Рига", en: "Riga", sv: "Riga" },
  Tallinn: { uk: "Таллінн", en: "Tallinn", sv: "Tallinn" },
  Bucharest: { uk: "Бухарест", en: "Bucharest", sv: "Bukarest" },
  Chisinau: { uk: "Кишинів", en: "Chișinău", sv: "Chișinău" },
  Budapest: { uk: "Будапешт", en: "Budapest", sv: "Budapest" },
  Bratislava: { uk: "Братислава", en: "Bratislava", sv: "Bratislava" },
  Athens: { uk: "Афіни", en: "Athens", sv: "Aten" },
  Istanbul: { uk: "Стамбул", en: "Istanbul", sv: "Istanbul" },
  Sofia: { uk: "Софія", en: "Sofia", sv: "Sofia" },
  Tbilisi: { uk: "Тбілісі", en: "Tbilisi", sv: "Tbilisi" },
  Dubai: { uk: "Дубай", en: "Dubai", sv: "Dubai" },
  Jerusalem: { uk: "Єрусалим", en: "Jerusalem", sv: "Jerusalem" },
  New_York: { uk: "Нью-Йорк", en: "New York", sv: "New York" },
  Toronto: { uk: "Торонто", en: "Toronto", sv: "Toronto" },
  Chicago: { uk: "Чикаго", en: "Chicago", sv: "Chicago" },
  Los_Angeles: { uk: "Лос-Анджелес", en: "Los Angeles", sv: "Los Angeles" },
  Vancouver: { uk: "Ванкувер", en: "Vancouver", sv: "Vancouver" },
};

/** Пояс, з яким `Intl` справді вміє працювати; інакше — київський. */
export function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/**
 * Пояси людей за id. Читає RPC `people_timezones` (service_role бачить усіх, кого спитав).
 * Функції ще немає в базі (міграцію не вставлено) або читання впало → порожня мапа, і всі
 * отримують київський час із позначкою: повідомлення не зупиняється через пояс.
 */
export async function loadTimeZones(admin: any, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  for (let i = 0; i < uniq.length; i += 400) {
    try {
      const { data, error } = await (admin.rpc as any)("people_timezones", { _ids: uniq.slice(i, i + 400) });
      if (error) return out;
      for (const r of (data ?? []) as Array<{ user_id: string; timezone: string | null }>) {
        if (r.timezone) out.set(r.user_id, safeTz(r.timezone));
      }
    } catch {
      return out;
    }
  }
  return out;
}

/** Пояс першої людини зі списку, чий пояс відомий; нікого — київський. */
export function tzFor(zones: Map<string, string>, ...ids: Array<string | null | undefined>): string {
  for (const id of ids) {
    const tz = id ? zones.get(id) : undefined;
    if (tz) return tz;
  }
  return DEFAULT_TZ;
}

/** «GMT+1», «GMT+5:30», «GMT». */
export function gmtOffset(tz: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    return /^GMT[+\-\u2212]0+(:00)?$/.test(part) ? "GMT" : part.replace("\u2212", "-");
  } catch {
    return "GMT";
  }
}

/** Місто поясу мовою листа; невідоме — як у записі IANA. */
export function zoneCity(tz: string, lang: TzLang = "uk"): string {
  const raw = (tz.split("/").pop() ?? tz).trim();
  if (!raw || raw === "UTC" || raw === "GMT") return "";
  const key = raw === "Kiev" ? "Kyiv" : raw;
  return CITY[key]?.[lang] ?? raw.replace(/_/g, " ");
}

/** «Берлін (GMT+1)». */
export function zoneLabel(tz: string, at: Date = new Date(), lang: TzLang = "uk"): string {
  const city = zoneCity(tz, lang);
  const off = gmtOffset(tz, at);
  return city ? `${city} (${off})` : off;
}

/** Хвостик до часу в реченні: « (Берлін, GMT+1)». */
export function zoneSuffix(tz: string, at: Date = new Date(), lang: TzLang = "uk"): string {
  const city = zoneCity(tz, lang);
  return ` (${city ? `${city}, ` : ""}${gmtOffset(tz, at)})`;
}

/** Рядок під списком часів (дайджест, перелік уроків): «🌍 Час: Берлін (GMT+1)». */
export function zoneLine(tz: string, at: Date = new Date(), lang: TzLang = "uk"): string {
  const word = lang === "en" ? "Time" : lang === "sv" ? "Tid" : "Час";
  return `🌍 ${word}: ${zoneLabel(tz, at, lang)}`;
}

// ── Коли позначка потрібна ──────────────────────────────────────────────────────────────────
// Людині, про яку ми ЗНАЄМО, що її годинник іде за Києвом, час і так «її» — хвостик у кожному
// повідомленні був би шумом для більшості. Позначку ставимо там, де можна помилитись: читач за
// межами київського часу або його пояс невідомий (тоді час київський — і це треба сказати).

export interface ReaderZone { tz: string; known: boolean }

/** Пояс читача: перший відомий зі списку людей; нікого — київський і `known = false`. */
export function readerZone(zones: Map<string, string>, ...ids: Array<string | null | undefined>): ReaderZone {
  for (const id of ids) {
    const tz = id ? zones.get(id) : undefined;
    if (tz) return { tz, known: true };
  }
  return { tz: DEFAULT_TZ, known: false };
}

function offsetMin(tz: string, at: Date): number {
  try {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).reduce<Record<string, number>>((a, x) => { if (x.type !== "literal") a[x.type] = Number(x.value); return a; }, {});
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/** Чи треба називати пояс цьому читачеві в цей момент. */
export function zoneNeeded(z: ReaderZone, at: Date = new Date()): boolean {
  return !z.known || offsetMin(z.tz, at) !== offsetMin(DEFAULT_TZ, at);
}

/** Хвостик до часу — або порожньо, якщо читач свідомо живе за київським часом. */
export function zoneTail(z: ReaderZone, at: Date = new Date(), lang: TzLang = "uk"): string {
  return zoneNeeded(z, at) ? zoneSuffix(z.tz, at, lang) : "";
}

/** Рядок під списком часів — або null. */
export function zoneLineIfNeeded(z: ReaderZone, at: Date = new Date(), lang: TzLang = "uk"): string | null {
  return zoneNeeded(z, at) ? zoneLine(z.tz, at, lang) : null;
}
