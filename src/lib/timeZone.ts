/**
 * Часовий пояс — словами (14.11, питання власниці: «не дуже зрозуміло, по якому часовому поясу
 * я назначаю урок. Я в Стокгольмі, репетитор у Києві, учень у Берліні»).
 *
 * Як це працює в застосунку: урок зберігається як МОМЕНТ часу, а кожен пристрій показує його за
 * власним поясом. Тобто 15:00, які менеджерка ставить у Стокгольмі, — це 16:00 у репетитора в
 * Києві й 15:00 в учня в Берліні, і кожен побачить «свою» цифру. Це правильно, але було
 * невидимо: поруч із жодним полем часу не стояло, ЧИЙ це час. Тепер стоїть — у кожному місці,
 * де час встановлюють (`TimeZoneNote`).
 *
 * Пояс беремо з пристрою (`Intl`), у базі його немає. Зсув рахуємо на ДАТУ уроку, а не на
 * сьогодні: Стокгольм узимку GMT+1, улітку GMT+2 — урок на липень, поставлений у листопаді,
 * мусить показати літній зсув.
 */
import i18n from "@/i18n";

/** Пояс пристрою в записі IANA («Europe/Stockholm»); якщо браузер не каже — UTC. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** «GMT+1», «GMT+5:30», «GMT» — зсув поясу `tz` у момент `at`. */
export function gmtOffsetLabel(tz: string, at: Date = new Date()): string {
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(when).find((p) => p.type === "timeZoneName")?.value;
    if (part) return /^GMT[+\-\u2212]0+(:00)?$/.test(part) ? "GMT" : part.replace("\u2212", "-");
  } catch { /* старий браузер без shortOffset — рахуємо самі нижче */ }
  try {
    // різниця між «тим самим моментом, прочитаним у поясі» і UTC
    const f = (zone: string) => new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(when).reduce<Record<string, number>>((a, p) => { if (p.type !== "literal") a[p.type] = Number(p.value); return a; }, {});
    const a = f(tz), b = f("UTC");
    const min = Math.round((Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute) - Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute)) / 60000);
    if (min === 0) return "GMT";
    const abs = Math.abs(min), h = Math.floor(abs / 60), m = abs % 60;
    return `GMT${min > 0 ? "+" : "-"}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  } catch {
    return "GMT";
  }
}

/** Місто поясу мовою застосунку («Стокгольм»); невідоме — як у записі IANA, без підкреслень. */
export function zoneCity(tz: string): string {
  const raw = (tz.split("/").pop() ?? tz).trim();
  if (!raw || raw === "UTC" || raw === "GMT") return "";
  const key = raw === "Kiev" ? "Kyiv" : raw;                 // стара назва поясу в частини браузерів
  const translated = i18n.t(`timeZone.cities.${key}`, { defaultValue: "" });
  return translated || raw.replace(/_/g, " ");
}

/** «Стокгольм (GMT+1)» — або просто «GMT+1», коли міста пояс не називає. */
export function zoneLabel(tz: string = deviceTimeZone(), at: Date = new Date()): string {
  const city = zoneCity(tz);
  const off = gmtOffsetLabel(tz, at);
  return city ? `${city} (${off})` : off;
}

/**
 * Хвостик для часу, який іде ІНШІЙ людині текстом (сповіщення): « (Стокгольм, GMT+1)».
 * Текст сповіщення пишеться на пристрої того, хто ставить урок, — тобто в його поясі, а читає
 * його людина в іншому місті. Без хвостика «о 15:00» від менеджерки зі Стокгольма репетиторка
 * в Києві читала як свої 15:00, хоча в її розкладі цей урок стоїть на 16:00.
 */
export function zoneSuffix(at: Date = new Date(), tz: string = deviceTimeZone()): string {
  const city = zoneCity(tz);
  const off = gmtOffsetLabel(tz, at);
  return ` (${city ? `${city}, ` : ""}${off})`;
}

/** Момент із того, що тримає форма: Date, ISO-рядок або «YYYY-MM-DDTHH:mm» (місцевий час). */
export function toInstant(v: Date | string | null | undefined): Date {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? new Date() : v;
  if (typeof v === "string" && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

// ── Пояс ІНШОЇ людини (14.11, пакет «кожному — його час») ─────────────────────────────────────
// Пояс пристрою застосунок записує в `profiles.timezone` (RPC `set_my_timezone`), читає пояси
// тих, кого людина й так бачить (`people_timezones`). Усе нижче — чиста арифметика над поясами.

/** Зсув поясу від UTC у хвилинах у момент `at` (Київ узимку = 120). Невідомий пояс → 0. */
export function offsetMinutes(tz: string, at: Date = new Date()): number {
  try {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).reduce<Record<string, number>>((a, x) => { if (x.type !== "literal") a[x.type] = Number(x.value); return a; }, {});
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

export interface WallTime { iso: string; y: number; m0: number; d: number; minutes: number; weekday: number }

/** Що показує годинник у поясі `tz` у момент `at`: дата, хвилини від півночі, день тижня (0 = нд). */
export function wallInZone(at: Date, tz: string): WallTime {
  const shifted = new Date(at.getTime() + offsetMinutes(tz, at) * 60000);
  const y = shifted.getUTCFullYear(), m0 = shifted.getUTCMonth(), d = shifted.getUTCDate();
  return {
    y, m0, d,
    iso: `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** Момент, коли в поясі `tz` на годиннику дата `iso` («YYYY-MM-DD») і `minutes` хвилин від півночі. */
export function wallToInstant(iso: string, minutes: number, tz: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const guess = Date.UTC(y, (m || 1) - 1, d || 1, 0, minutes);
  let t = guess - offsetMinutes(tz, new Date(guess)) * 60000;
  t = guess - offsetMinutes(tz, new Date(t)) * 60000;        // друге наближення — біля переходу на літній час
  return new Date(t);
}

/** Чи показують два пояси той самий час у момент `at` (Стокгольм і Берлін — так, Київ — ні). */
export function sameClock(a: string, b: string, at: Date = new Date()): boolean {
  return a === b || offsetMinutes(a, at) === offsetMinutes(b, at);
}

/**
 * Час моменту `at` на годиннику людини в поясі `tz`: «16:00», а якщо в неї вже інший день —
 * «нд 01:00». Мова — мова застосунку.
 */
export function timeInZone(at: Date, tz: string, viewerTz: string = deviceTimeZone(), locale?: string): string {
  const loc = locale ?? i18n.language ?? "uk";
  try {
    const hm = new Intl.DateTimeFormat(loc, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    if (wallInZone(at, tz).iso === wallInZone(at, viewerTz).iso) return hm;
    const wd = new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: "short" }).format(at);
    return `${wd} ${hm}`;
  } catch {
    return "";
  }
}
