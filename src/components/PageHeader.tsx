import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  children?: React.ReactNode; // extra elements between title and icons (tabs, filters etc)
  className?: string;
}

/**
 * Unified page header: title (left) + [bell][burger] (right)
 * Used on all main pages for consistent layout.
 */
export function PageHeader({ title, children, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-extrabold text-foreground sm:text-2xl">{title}</h1>
        <div className="flex items-center gap-2 shrink-0">
          <NotificationBell />
          <Link
            to="/profile"
            aria-label="Меню"
            className="flex h-11 w-11 items-center justify-center rounded-[14px] text-foreground transition-colors hover:bg-muted"
            style={{ background: "var(--teal,#2BBFAA)", color: "#fff" }}
          >
            <Menu className="h-5 w-5" />
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}
