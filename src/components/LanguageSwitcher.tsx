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

const LANGS = [
  { code: "uk", labelKey: "ukrainian", short: "UA" },
  { code: "en", labelKey: "english", short: "EN" },
  { code: "sv", labelKey: "swedish", short: "SV" },
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
        <Button variant={variant} size={size} className={className}>
          <Globe className="h-4 w-4" />
          {showLabel && <span className="ml-1.5 text-[13px] font-semibold">{currentShort}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGS.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => change(l.code)}
            className={current === l.code ? "font-semibold" : ""}
          >
            <span className="mr-2 text-[13px] text-muted-foreground">{l.short}</span>
            {t(`languageSwitcher.${l.labelKey}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
