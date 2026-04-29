import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
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
      <p
        className={cn(
          "mt-1 truncate font-display font-bold text-foreground",
          compact ? "text-lg sm:text-xl" : "mt-2 text-2xl",
        )}
      >
        {value}
      </p>
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
