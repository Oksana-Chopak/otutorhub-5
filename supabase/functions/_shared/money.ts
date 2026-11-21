/**
 * ГРОШІ В СЕРВЕРНИХ ПОВІДОМЛЕННЯХ — одна валюта на пару, і жодного вшитого «₴» (21.11).
 *
 * Скарга власниці 21.11: «мені в Telegram приходять борги від нової учениці 28 гривень, тоді як
 * вона оплачує 14 євро за урок». Ранковий дайджест складав числа з `lesson_details.student_price`
 * і дописував «₴» — а валюта живе не на уроці, а на ПАРІ «учень — репетитор»
 * (`student_rates.currency`). Два уроки по 14 € ставали «28 ₴». Те саме робили тижневий і
 * вечірній дайджести, нагадування про оплату з кнопки (текст ішов батькам!), штраф за
 * скасування. У застосунку цей клас закритий воротами `check-currency`, але вони дивились лише
 * в `src/` — серверні функції лишались поза ними.
 *
 * Правило тепер одне, і воно те саме, що у вʼю `lessons_visible` (за якою рахує застосунок):
 *   валюта уроку = валюта чинної (не архівної) ціни пари; якщо в пари кілька цін — та, що на
 *   предмет уроку, інакше найновіша; для учасника групи — валюта його рядка; нічого немає — UAH.
 * Суми в РІЗНИХ валютах ніколи не складаються в одне число: «1 200 ₴ + 28 €».
 *
 * Виплата репетиторові школи валюти в базі не має (ставка — число): це валюта школи, сьогодні
 * гривня. `PAYOUT_CURRENCY` — єдине місце, де це записано.
 */
import { fetchAllRows } from "./fetchAll.ts";

export const DEFAULT_CURRENCY = "UAH";
/** Валюта виплат репетиторам школи: ставка виплати в базі — число без валюти. */
export const PAYOUT_CURRENCY = "UAH";

const SYM: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", GBP: "£", SEK: "kr", PLN: "zł" };

/** Знак валюти; невідомий код показується як є («CHF»), а не підміняється гривнею. */
export function sym(code?: string | null): string {
  const c = String(code ?? "").trim().toUpperCase() || DEFAULT_CURRENCY;
  return SYM[c] ?? c;
}

/** 10200 → «10 200»; 14.5 → «14,5» (звичайний пробіл: у Telegram і листах він не ламається). */
export function fmtNum(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [int, frac] = Math.abs(v).toFixed(2).split(".");
  const head = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const tail = frac === "00" ? "" : "," + frac.replace(/0$/, "");
  return (v < 0 ? "−" : "") + head + tail;
}

/** «28 €», «1 200 ₴». */
export function money(amount: number, currency?: string | null): string {
  return `${fmtNum(amount)} ${sym(currency)}`;
}

/** Сума по валютах. Валюти не змішуються: `text()` → «1 200 ₴ + 28 €». */
export class Money {
  private by = new Map<string, number>();

  add(amount: unknown, currency?: string | null): this {
    const v = Number(amount) || 0;
    if (v === 0) return this;
    const c = String(currency ?? "").trim().toUpperCase() || DEFAULT_CURRENCY;
    this.by.set(c, (this.by.get(c) ?? 0) + v);
    return this;
  }

  /** Чи є хоч якась сума. */
  get any(): boolean {
    for (const v of this.by.values()) if (v > 0) return true;
    return false;
  }

  /** Скільки валют у сумі. */
  get currencies(): string[] {
    return [...this.by.entries()].filter(([, v]) => v > 0).map(([c]) => c);
  }

  /** Число для впорядкування списку «хто винен більше» (валюти тут не порівнюються точно). */
  get weight(): number {
    let s = 0;
    for (const v of this.by.values()) s += v;
    return s;
  }

  /** Сума однієї валюти (для полів, які зберігають число поруч із кодом валюти). */
  of(currency: string): number {
    return this.by.get(currency.toUpperCase()) ?? 0;
  }

  /** «1 200 ₴ + 28 €» — гривня першою, далі за спаданням; порожньо → «0 ₴». */
  text(): string {
    const parts = [...this.by.entries()].filter(([, v]) => v > 0);
    if (parts.length === 0) return money(0, DEFAULT_CURRENCY);
    parts.sort((a, b) => (a[0] === DEFAULT_CURRENCY ? -1 : b[0] === DEFAULT_CURRENCY ? 1 : b[1] - a[1]));
    return parts.map(([c, v]) => money(v, c)).join(" + ");
  }
}

export type RateRow = { tutor_id: string; student_id: string; subject: string | null; currency: string | null; archived_at: string | null; created_at: string | null };
export type LessonLike = { tutor_id?: string | null; student_id?: string | null; subject?: string | null };

/** Вибір валюти уроку з цін пари — дзеркало вʼю `lessons_visible` (чиста функція, для тестів). */
export function pickCurrency(rates: RateRow[], lesson: LessonLike): string {
  const live = rates.filter((r) => !r.archived_at && r.currency);
  if (live.length === 0) return DEFAULT_CURRENCY;
  const subj = String(lesson.subject ?? "");
  const sorted = [...live].sort((a, b) => {
    const am = String(a.subject ?? "") === subj ? 0 : 1;
    const bm = String(b.subject ?? "") === subj ? 0 : 1;
    if (am !== bm) return am - bm;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
  return String(sorted[0].currency).toUpperCase();
}

/**
 * Валюти пар для набору уроків: один прохід по `student_rates` репетиторів цих уроків.
 * Повертає функцію «урок → код валюти». Збій читання НЕ перетворюється на гривню мовчки:
 * `failed = true`, і той, хто кличе, пише чесне «не вдалося перевірити».
 */
export async function loadCurrencies(
  // deno-lint-ignore no-explicit-any
  sb: any,
  lessons: LessonLike[],
): Promise<{ of: (l: LessonLike) => string; failed: boolean }> {
  const tutorIds = [...new Set(lessons.map((l) => l.tutor_id).filter(Boolean) as string[])];
  const byPair = new Map<string, RateRow[]>();
  let failed = false;
  for (let i = 0; i < tutorIds.length; i += 100) {
    const chunk = tutorIds.slice(i, i + 100);
    const { data, error } = await fetchAllRows<RateRow>((a, b) => sb
      .from("student_rates")
      .select("tutor_id, student_id, subject, currency, archived_at, created_at")
      .in("tutor_id", chunk)
      .order("id", { ascending: true })
      .range(a, b));
    if (error) { failed = true; console.error("money: student_rates read failed", error.message); }
    for (const r of data ?? []) {
      const k = `${r.tutor_id}:${r.student_id}`;
      const list = byPair.get(k);
      if (list) list.push(r); else byPair.set(k, [r]);
    }
  }
  return {
    of: (l) => pickCurrency(byPair.get(`${l.tutor_id}:${l.student_id}`) ?? [], l),
    failed,
  };
}
