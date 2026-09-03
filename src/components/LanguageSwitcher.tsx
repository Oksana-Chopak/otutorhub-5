import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LanguageSwitcherProps {
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "icon";
  showLabel?: boolean;
  className?: string;
}

/* Перевірка 03.09 у браузері: назви мов писались МОВОЮ ІНТЕРФЕЙСУ —
   українцю «Шведська», шведу «Ukrainska». Тобто швед, який випадково
   опинився в українському інтерфейсі, не може знайти свою мову за назвою:
   вона написана незнайомою абеткою. Перемикач мови — єдине місце, де назва
   мусить бути ЕНДОНІМОМ (мовою самої мови), бо його читає той, хто поточної
   мови ще не розуміє. Це прямо на шляху виходу у Швецію. */
const LANGS = [
  { code: "uk", endonym: "Українська", short: "UA" },
  { code: "en", endonym: "English",    short: "EN" },
  { code: "sv", endonym: "Svenska",    short: "SV" },
] as const;

export function LanguageSwitcher({
  variant = "ghost",
  size = "sm",
  showLabel = true,
  className,
}: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const resolved = i18n.resolvedLanguage ?? "uk";
  const current = resolved.startsWith("en") ? "en" : resolved.startsWith("sv") ? "sv" : "uk";
  const currentShort = LANGS.find((l) => l.code === current)?.short ?? "UA";

  const change = (code: string) => {
    void i18n.changeLanguage(code);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className} aria-label={t("languageSwitcher.aria")}>
          <Globe className="h-4 w-4" />
          {showLabel && <span className="ml-1.5 text-[14px] font-semibold">{currentShort}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGS.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => change(l.code)}
            className={current === l.code ? "font-semibold" : ""}
          >
            <span className="mr-2 text-[14px] text-muted-foreground">{l.short}</span>
            {l.endonym}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
