import { cn } from "@/lib/utils";
import { LucideIcon, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "react-router-dom";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  /** Numeric delta vs previous period. Renders ▲/▼ chip when provided. */
  trendDelta?: number;
  variant?: "default" | "success" | "warning";
  to?: string;
  /**
   * Compact: label + icon + value stacked tightly, smaller paddings.
   * Used on dashboards where many stats need to fit on a phone screen.
   * Defaults to true.
   */
  compact?: boolean;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendDelta,
  variant = "default",
  to,
  compact = true,
}: StatCardProps) {
  const iconBox = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform group-hover:scale-110 group-hover:-rotate-6",
        compact ? "h-9 w-9" : "h-10 w-10",
        variant === "success" && "bg-gradient-to-br from-success/20 to-success/10 text-success",
        variant === "warning" && "bg-gradient-to-br from-warning/20 to-warning/10 text-warning",
        variant === "default" && "bg-gradient-to-br from-primary/20 to-primary/10 text-primary",
      )}
    >
      <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
    </div>
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "min-w-0 font-medium text-muted-foreground",
            compact ? "text-[11px] leading-tight sm:text-xs" : "text-sm",
          )}
        >
          {label}
        </p>
        {iconBox}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <p
          className={cn(
            "truncate font-display font-bold text-foreground",
            compact ? "text-lg sm:text-xl" : "mt-1 text-2xl",
          )}
        >
          {value}
        </p>
        {typeof trendDelta === "number" && trendDelta !== 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              trendDelta > 0
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {trendDelta > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {Math.abs(trendDelta)}
          </span>
        )}
        {to && (
          <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        )}
      </div>
      {trend && (
        <p className={cn("mt-1 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
          {trend}
        </p>
      )}
    </>
  );

  const baseClasses = cn(
    "group rounded-2xl border border-border bg-card transition-all duration-200",
    compact ? "p-3" : "p-5",
  );

  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          baseClasses,
          "block hover:border-primary/40 hover:-translate-y-1 hover:shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.25)]",
        )}
      >
        {content}
      </Link>
    );
  }

  return <div className={baseClasses}>{content}</div>;
}
