import { ReactNode, useState } from "react";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface MobileFiltersProps {
  children: ReactNode;
  /** Number of currently active (non-default) filters — shown as a badge. */
  activeCount?: number;
  /** Optional extra className for the container. */
  className?: string;
  /** Optional desktop slot — when set, on `lg+` shows children inline instead of trigger. */
  desktopInline?: boolean;
  /** When true, mobile trigger is rendered as a compact icon-only button. */
  compact?: boolean;
  /** Where the collapsible content panel anchors. Defaults to 'left'. */
  align?: "left" | "right";
}

/**
 * Mobile-first filter bar. On mobile it shows a single "Фільтри" trigger that
 * expands a panel with the children. On desktop (>= lg) when `desktopInline`
 * is true, the trigger is hidden and children render inline as before.
 */
export function MobileFilters({
  children,
  activeCount = 0,
  className,
  desktopInline = true,
  compact = false,
  align = "left",
}: MobileFiltersProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("relative", className)}>
      {/* Mobile: collapsible trigger + content */}
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className={cn(desktopInline && "lg:hidden")}
      >
        <CollapsibleTrigger asChild>
          {compact ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative h-9 w-9 shrink-0"
              aria-label={t("filters.label")}
            >
              {open ? <X className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
              {activeCount > 0 && !open && (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-sm">
                  {activeCount}
                </span>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-full justify-between gap-2 sm:w-auto"
            >
              <span className="flex items-center gap-2">
                {open ? <X className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
                {t("filters.label")}
                {activeCount > 0 && (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {activeCount}
                  </span>
                )}
              </span>
            </Button>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            "mt-2",
            compact &&
              cn(
                "absolute z-30 w-[calc(100vw-2rem)] max-w-xs",
                align === "right" ? "right-0" : "left-0",
              ),
          )}
        >
          <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-popover p-3 shadow-lg">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Desktop: render inline */}
      {desktopInline && (
        <div className="hidden flex-wrap gap-2 lg:flex">{children}</div>
      )}
    </div>
  );
}
