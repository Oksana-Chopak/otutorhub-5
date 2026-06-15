import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { toast } from "sonner";

export interface CurrencyMeta {
  code: string;
  symbol: string;
  flag: string;
  name: string;
}

export const COMMON_CURRENCIES: CurrencyMeta[] = [
  { code: "UAH", symbol: "₴", flag: "🇺🇦", name: "UAH" },
  { code: "USD", symbol: "$", flag: "🇺🇸", name: "USD" },
  { code: "EUR", symbol: "€", flag: "🇪🇺", name: "EUR" },
  { code: "PLN", symbol: "zł", flag: "🇵🇱", name: "PLN" },
  { code: "SEK", symbol: "kr", flag: "🇸🇪", name: "SEK" },
  { code: "CZK", symbol: "Kč", flag: "🇨🇿", name: "CZK" },
  { code: "GBP", symbol: "£", flag: "🇬🇧", name: "GBP" },
  { code: "CHF", symbol: "₣", flag: "🇨🇭", name: "CHF" },
  { code: "NOK", symbol: "kr", flag: "🇳🇴", name: "NOK" },
  { code: "DKK", symbol: "kr", flag: "🇩🇰", name: "DKK" },
  { code: "HUF", symbol: "Ft", flag: "🇭🇺", name: "HUF" },
  { code: "RON", symbol: "lei", flag: "🇷🇴", name: "RON" },
];

const CUSTOM_CODE_RE = /^[A-Z]{2,6}$/;

interface Props {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  disabled?: boolean;
}

export function CurrencyComboBox({ value, onChange, className, disabled }: Props) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useWorkspaceSettings();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const customCodes = (settings?.custom_currencies ?? []).filter(
    (c) => !COMMON_CURRENCIES.some((cc) => cc.code === c),
  );

  const allKnown = [
    ...COMMON_CURRENCIES,
    ...customCodes.map<CurrencyMeta>((c) => ({ code: c, symbol: c, flag: "💱", name: c })),
  ];

  const localizedName = (c: CurrencyMeta) =>
    t(`currencyComboBox.name.${c.code}`, { defaultValue: c.name });

  const q = query.trim().toUpperCase();
  const filtered = q
    ? allKnown.filter(
        (c) =>
          c.code.includes(q) ||
          localizedName(c).toLowerCase().includes(query.toLowerCase()),
      )
    : allKnown;

  const showAddCustom =
    CUSTOM_CODE_RE.test(q) && !allKnown.some((c) => c.code === q);

  const selected = allKnown.find((c) => c.code === value);

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
  };

  const handleAddCustom = async () => {
    if (!CUSTOM_CODE_RE.test(q)) {
      toast.error(t("currencyComboBox.customCurrencyInvalid"));
      return;
    }
    const next = Array.from(new Set([...(settings?.custom_currencies ?? []), q]));
    const err = await updateSettings({ custom_currencies: next } as any);
    if (err) {
      toast.error(err.message);
      return;
    }
    handleSelect(q);
  };

  const common = filtered.filter((c) => COMMON_CURRENCIES.some((cc) => cc.code === c.code));
  const custom = filtered.filter((c) => !COMMON_CURRENCIES.some((cc) => cc.code === c.code));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-11 w-full justify-between text-base font-normal", className)}
        >
          <span className="truncate">
            {selected
              ? `${selected.flag} ${selected.code}`
              : value
                ? `💱 ${value}`
                : t("currencyComboBox.selectCurrency")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("currencyComboBox.searchCurrency")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {common.length === 0 && custom.length === 0 && !showAddCustom && (
              <CommandEmpty>{t("subjectComboBox.noResults")}</CommandEmpty>
            )}
            {common.length > 0 && (
              <CommandGroup heading={t("currencyComboBox.commonCurrencies")}>
                {common.map((c) => (
                  <CommandItem key={c.code} value={c.code} onSelect={() => handleSelect(c.code)}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === c.code ? "opacity-100" : "opacity-0")}
                    />
                    <span className="mr-2">{c.flag}</span>
                    <span className="font-medium">{c.code}</span>
                    <span className="ml-2 text-muted-foreground">— {localizedName(c)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {custom.length > 0 && (
              <CommandGroup heading={t("currencyComboBox.customCurrencies")}>
                {custom.map((c) => (
                  <CommandItem key={c.code} value={c.code} onSelect={() => handleSelect(c.code)}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === c.code ? "opacity-100" : "opacity-0")}
                    />
                    <span className="mr-2">💱</span>
                    <span className="font-medium">{c.code}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showAddCustom && (
              <CommandGroup>
                <CommandItem
                  value={`add-${q}`}
                  onSelect={handleAddCustom}
                  className="text-primary"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("currencyComboBox.addCustomCurrency", { code: q })}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
