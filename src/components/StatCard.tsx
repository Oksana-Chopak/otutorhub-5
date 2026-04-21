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
}

export function StatCard({ label, value, icon: Icon, trend, variant = "default", to }: StatCardProps) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            variant === "success" && "bg-success/10 text-success",
            variant === "warning" && "bg-warning/10 text-warning",
            variant === "default" && "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-foreground">{value}</p>
      {trend && <p className="mt-1 text-xs text-muted-foreground">{trend}</p>}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
      >
        {content}
      </Link>
    );
  }

  return <div className="rounded-xl border border-border bg-card p-5">{content}</div>;
}
