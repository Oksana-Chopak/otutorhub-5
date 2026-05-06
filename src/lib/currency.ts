export type CurrencyCode = "UAH" | "USD" | "EUR" | "SEK" | "PLN" | "GBP";

export const CURRENCY_OPTIONS: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: "UAH", symbol: "₴", label: "₴ UAH" },
  { code: "USD", symbol: "$", label: "$ USD" },
  { code: "EUR", symbol: "€", label: "€ EUR" },
  { code: "SEK", symbol: "kr", label: "kr SEK" },
  { code: "PLN", symbol: "zł", label: "zł PLN" },
  { code: "GBP", symbol: "£", label: "£ GBP" },
];

const SYMBOLS: Record<string, string> = Object.fromEntries(
  CURRENCY_OPTIONS.map((c) => [c.code, c.symbol]),
);

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
  const sym = currencySymbol(currency);
  const value = opts.decimals != null ? n.toFixed(opts.decimals) : String(n);
  // For symbols that are letter-based (kr, zł), put a space.
  const isLetter = /[a-zA-Złk]/i.test(sym);
  return isLetter ? `${value} ${sym}` : `${value} ${sym}`;
}
