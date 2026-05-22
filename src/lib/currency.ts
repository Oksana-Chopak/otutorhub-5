export type CurrencyCode = "UAH" | "USD" | "EUR" | "SEK" | "PLN" | "GBP";

export const CURRENCY_OPTIONS: { code: string; symbol: string; label: string }[] = [
  { code: "UAH", symbol: "₴", label: "₴ UAH" },
  { code: "USD", symbol: "$", label: "$ USD" },
  { code: "EUR", symbol: "€", label: "€ EUR" },
  { code: "SEK", symbol: "kr", label: "kr SEK" },
  { code: "PLN", symbol: "zł", label: "zł PLN" },
  { code: "GBP", symbol: "£", label: "£ GBP" },
];

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
      : new Intl.NumberFormat("uk-UA", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(n);

  if (symbol) {
    return SYMBOL_AFTER.has(code) ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
  }
  return `${formatted} ${code}`;
}
