import { ReactNode } from "react";
import { useLocation, NavLink } from "react-router-dom";
import { CalendarDays, MessageSquare, DollarSign, BookOpen, LayoutDashboard, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon, LogOut } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";

const NAV_DEFS = [
  { to: "/student-dashboard", labelKey: "studentNav.dashboard", titleKey: "studentNav.myDashboard", icon: LayoutDashboard },
  { to: "/student/schedule", labelKey: "studentNav.schedule", titleKey: "studentNav.schedule", icon: CalendarDays },
  { to: "/student/payments", labelKey: "studentNav.payments", titleKey: "studentNav.payments", icon: DollarSign },
  { to: "/student/homework", labelKey: "studentNav.homework", titleKey: "studentNav.myHomework", icon: BookOpen },
  { to: "/chats", labelKey: "studentNav.chats", titleKey: "studentNav.chats", icon: MessageSquare, badgeKey: "chats" as const },
  { to: "/student/profile", labelKey: "studentNav.profile", titleKey: "studentNav.profile", icon: UserCircle },
];

export function StudentLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const chats = useUnreadChats();
  const { signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const items = NAV_DEFS.map((d) => ({ ...d, label: t(d.labelKey) }));
  const mobileItems = items.filter((i) => i.to !== "/student/profile").slice(0, 5);
  const titleDef = NAV_DEFS.find((d) => d.to === pathname);
  const title = titleDef ? t(titleDef.titleKey) : undefined;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-5 py-5">
          <img src="/logo.png" alt="oTutorHub" className="h-8 w-8" />
          <span className="font-display text-lg font-bold text-foreground">oTutorHub</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {items.map((item) => {
            const badge = item.badgeKey === "chats" ? chats : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/student-dashboard"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-border px-4 py-4 space-y-2">
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> {t("studentNav.logout")}
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <LanguageSwitcher variant="outline" size="icon" showLabel={false} className="h-9 w-9" />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto pb-20 lg:pb-0">
        {title && (
          <header className="sticky top-0 z-20 flex h-14 items-center border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
            <h1 className="font-display text-lg font-semibold text-foreground">{title}</h1>
          </header>
        )}
        <div className="mx-auto max-w-5xl px-4 pt-4 pb-6 lg:px-8 lg:pt-8 lg:py-8">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch justify-around">
          {mobileItems.map((item) => {
            const badge = item.badgeKey === "chats" ? chats : 0;
            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === "/student-dashboard"}
                  className={({ isActive }) =>
                    cn(
                      "relative flex min-h-[60px] flex-col items-center justify-center gap-1 px-1 py-2 text-[12px] font-medium transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )
                  }
                >
                  <span className="relative">
                    <item.icon className="h-6 w-6" />
                    {badge > 0 && (
                      <span className="absolute -right-2.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </span>
                  <span className="truncate leading-tight">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
