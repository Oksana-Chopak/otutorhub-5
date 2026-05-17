import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  CalendarDays,
  MessageSquare,
  Users,
  GraduationCap,
  Coins,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { useAvailabilityRequestCount } from "@/hooks/useAvailabilityRequestCount";

type Item = {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
  badgeKey?: "chats" | "availability";
};

// Single 6-item navigation per role — must match AppSidebar.
const items: Item[] = [
  // Tutor
  { to: "/", labelKey: "nav.dashboard", icon: Home, roles: ["tutor"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["tutor"], badgeKey: "availability" },
  { to: "/my-students", labelKey: "nav.studentsShort", icon: GraduationCap, roles: ["tutor"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["tutor"], badgeKey: "chats" },
  { to: "/finances", labelKey: "nav.finances", icon: Coins, roles: ["tutor"] },
  // Manager
  { to: "/", labelKey: "nav.dashboard", icon: Home, roles: ["manager"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["manager"], badgeKey: "availability" },
  { to: "/people", labelKey: "nav.people", icon: Users, roles: ["manager"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["manager"], badgeKey: "chats" },
  { to: "/finances", labelKey: "nav.finances", icon: Coins, roles: ["manager"] },
  // Student
  { to: "/", labelKey: "nav.dashboard", icon: Home, roles: ["student"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["student"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["student"], badgeKey: "chats" },
];

export function MobileBottomNav() {
  const { t } = useTranslation();
  const { roles } = useAuth();
  const chats = useUnreadChats();
  const avail = useAvailabilityRequestCount();

  // Pick the items for the user's primary role (manager > tutor > student)
  const primary: AppRole | undefined = roles.includes("manager")
    ? "manager"
    : roles.includes("tutor")
    ? "tutor"
    : roles.includes("student")
    ? "student"
    : undefined;

  if (!primary) return null;
  const visible = items.filter((i) => i.roles.includes(primary)).slice(0, 6);
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
                    "relative flex min-h-[64px] flex-col items-center justify-center gap-1 px-1 py-2 text-[13px] font-medium transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <item.icon className="h-7 w-7" strokeWidth={isActive ? 2.25 : 2} />
                      {badge > 0 && (
                        <span className="absolute -right-2.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )}
                    </span>
                    <span className="truncate leading-tight">{t(item.labelKey)}</span>
                    {isActive && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
