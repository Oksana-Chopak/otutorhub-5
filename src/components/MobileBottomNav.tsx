import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  MessageSquare,
  Users,
  DollarSign,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { useAvailabilityRequestCount } from "@/hooks/useAvailabilityRequestCount";

const items: { to: string; label: string; icon: typeof LayoutDashboard; roles: AppRole[]; badgeKey?: "chats" | "availability" }[] = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard, roles: ["manager", "tutor", "student"] },
  { to: "/schedule", label: "Розклад", icon: CalendarDays, roles: ["manager", "tutor", "student"] },
  { to: "/chats", label: "Чати", icon: MessageSquare, roles: ["manager", "tutor", "student"], badgeKey: "chats" },
  { to: "/availability", label: "Години", icon: CalendarClock, roles: ["tutor"], badgeKey: "availability" },
  { to: "/finances", label: "Фінанси", icon: DollarSign, roles: ["manager"] },
  { to: "/people", label: "Люди", icon: Users, roles: ["manager"] },
];

export function MobileBottomNav() {
  const { roles } = useAuth();
  const chats = useUnreadChats();
  const avail = useAvailabilityRequestCount();

  const visible = items.filter((i) => i.roles.some((r) => roles.includes(r))).slice(0, 5);
  if (visible.length === 0) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around">
        {visible.map((item) => {
          const badge =
            item.badgeKey === "chats" ? chats : item.badgeKey === "availability" ? avail : 0;
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "relative flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )
                }
              >
                <span className="relative">
                  <item.icon className="h-5 w-5" />
                  {badge > 0 && (
                    <span className="absolute -right-2 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
