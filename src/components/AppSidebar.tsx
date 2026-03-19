import { NavLink as RouterNavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  CalendarDays,
  DollarSign,
  MessageSquare,
  Users,
  GraduationCap,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard },
  { to: "/schedule", label: "Розклад", icon: CalendarDays },
  { to: "/finances", label: "Фінанси", icon: DollarSign },
  { to: "/chats", label: "Чати", icon: MessageSquare },
  { to: "/people", label: "Люди", icon: Users },
];

export function AppSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-card p-2 shadow-md lg:hidden"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-6 py-5">
          <GraduationCap className="h-7 w-7 text-primary" />
          <span className="font-display text-lg font-bold text-foreground">
            TutorHub
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <RouterNavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )
              }
              end={item.to === "/"}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </RouterNavLink>
          ))}
        </nav>

        <div className="border-t border-border px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              МН
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Менеджер</p>
              <p className="text-xs text-muted-foreground">Адміністратор</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
