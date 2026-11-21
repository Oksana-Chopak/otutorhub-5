import { getLocale } from "@/lib/locale";
export type CurrencyCode = "UAH" | "USD" | "EUR" | "SEK" | "PLN" | "GBP";

export const CURRENCY_OPTIONS: { code: string; symbol: string; label: string }[] = [
  { code: "UAH", symbol: "₴", label: "₴ UAH" },
  { code: "USD", symbol: "$", label: "$ USD" },
  { code: "EUR", symbol: "€", label: "€ EUR" },
  { code: "SEK", symbol: "kr", label: "kr SEK" },
  { code: "PLN", symbol: "zł", label: "zł PLN" },
  { code: "GBP", symbol: "£", label: "£ GBP" },
];

/**
 * ВАЛЮТА ВИПЛАТ РЕПЕТИТОРАМ ШКОЛИ (21.11, скарга власниці про учениця «14 € за урок»).
 * Ставка виплати в базі — число без валюти (`tutor_subject_rates`, `tutor_details`): це валюта
 * школи, сьогодні гривня. Валюта ПАРИ (`student_rates.currency`) стосується лише того, що платить
 * учень. До 21.11 картка уроку й підсумки «Фінансів» підписували виплату валютою учня — і
 * виплата 300 ₴ за урок учениці, що платить у євро, показувалась як «€300», а прибуток школи
 * складав євро з гривнями в одне число. Правило:
 *   гроші учня — у валюті пари; виплата — у валюті школи; різні валюти в одне число не зливаються.
 * Серверне дзеркало — `supabase/functions/_shared/money.ts` → `PAYOUT_CURRENCY`.
 */
export const PAYOUT_CURRENCY = "UAH";

const SYMBOLS: Record<string, string> = {
  UAH: "₴", USD: "$", EUR: "€", PLN: "zł", SEK: "kr",
  CZK: "Kč", GBP: "£", CHF: "₣", NOK: "kr", DKK: "kr",
  HUF: "Ft", RON: "lei",
};

const SYMBOL_AFTER = new Set(["UAH", "PLN", "SEK", "CZK", "NOK", "DKK", "HUF", "RON"]);

export function currencySymbol(code?: string | null): string {
  if (!code) return "₴";
  return SYMBOLS[code] ?? code;
}

export function formatPrice(
  amount: number | string | null | undefined,
  currency?: string | null,
  opts: { decimals?: number } = {},
): string {
  const n = Number(amount ?? 0);
  const code = currency ?? "UAH";
  const symbol = SYMBOLS[code];
  const formatted =
    opts.decimals != null
      ? n.toFixed(opts.decimals)
      : new Intl.NumberFormat(getLocale(), {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(n);

  if (symbol) {
    return SYMBOL_AFTER.has(code) ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
  }
  return `${formatted} ${code}`;
}
