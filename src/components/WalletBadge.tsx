import { Wallet } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { cn } from "@/lib/utils";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface WalletBadgeProps {
  currency?: string;
  lessons: number;
  amount: number;
  onClick?: () => void;
  className?: string;
}

/**
 * Компактний індикатор балансу гаманця учня в межах пари.
 * Показує лише непорожні значення. Якщо порожній — лагідне «—».
 */
export function WalletBadge({ currency = "UAH", lessons, amount, onClick, className }: WalletBadgeProps) {
  const hasAny = lessons > 0 || amount > 0;
  const Component = onClick ? "button" : "span";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[14px] font-medium transition-colors",
        hasAny
          ? "bg-primary/10 text-primary hover:bg-primary/20"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
        onClick && "cursor-pointer",
        className,
      )}
      title={hasAny ? t("walletBadge.hasBalance") : t("walletBadge.empty")}
    >
      <Wallet className="h-3 w-3" />
      {hasAny ? (
        <>
          {lessons > 0 && <span>{lessons} ур.</span>}
          {lessons > 0 && amount > 0 && <span className="opacity-60">·</span>}
          {amount > 0 && <span>{formatPrice(amount, currency)}</span>}
        </>
      ) : (
        <span>—</span>
      )}
    </Component>
  );
}
