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
        "flex shrink-0 items-center justify-center rounded-lg",
        compact ? "h-8 w-8" : "h-9 w-9",
        variant === "success" && "bg-success/10 text-success",
        variant === "warning" && "bg-warning/10 text-warning",
        variant === "default" && "bg-primary/10 text-primary",
      )}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
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
    "rounded-xl border border-border bg-card transition-all",
    compact ? "p-3" : "p-5",
  );

  if (to) {
    return (
      <Link
        to={to}
        className={cn(baseClasses, "block hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5")}
      >
        {content}
      </Link>
    );
  }

  return <div className={baseClasses}>{content}</div>;
}
