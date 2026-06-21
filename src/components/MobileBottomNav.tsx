/**
 * MobileBottomNav — нижня навігація для сторінок усередині AppLayout.
 * - tutor/manager: 4 великі іконки без підписів.
 * - чистий студент: ДЗЕРКАЛО мобільного меню StudentLayout (ті самі пункти,
 *   іконки й підписи), щоб перехід на /chats чи /achievements не «перемикав»
 *   нижнє меню.
 */
import { NavLink, useLocation } from "react-router-dom";
import { Home, CalendarDays, Wallet, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { useAuth } from "@/hooks/useAuth";
import { STUDENT_NAV_DEFS } from "@/components/student/StudentLayout";
import { cn } from "@/lib/utils";

export function MobileBottomNav() {
  const unread = useUnreadChats();
  const location = useLocation();
  const { roles } = useAuth();
  const { t } = useTranslation();
  const isPureStudent =
    roles.includes("student") && !roles.includes("tutor") && !roles.includes("manager");

  // ── Студент: точна копія мобільного меню StudentLayout ──────────────────────
  if (isPureStudent) {
    const mobileItems = STUDENT_NAV_DEFS.filter((i) => i.to !== "/student/profile").slice(0, 5);
    return (
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch justify-around">
          {mobileItems.map((item) => {
            const badge = item.badgeKey === "chats" ? unread : 0;
            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === "/student-dashboard"}
                  className={({ isActive }) =>
                    cn(
                      "relative flex min-h-[60px] flex-col items-center justify-center gap-1 px-1 py-2 text-[14px] font-medium transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )
                  }
                >
                  <span className="relative">
                    <item.icon className="h-6 w-6" />
                    {badge > 0 && (
                      <span className="absolute -right-2.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[14px] font-semibold text-primary-foreground">
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </span>
                  <span className="truncate leading-tight">{t(item.labelKey)}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  // ── Tutor / manager: 4 іконки без підписів ──────────────────────────────────
  const tabs = [
    { to: "/", icon: Home, labelKey: "nav.dashboard" },
    { to: "/schedule", icon: CalendarDays, labelKey: "nav.schedule" },
    { to: "/finances", icon: Wallet, labelKey: "nav.finances" },
    { to: "/chats", icon: MessageSquare, labelKey: "nav.chats" },
  ] as const;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 lg:hidden"
      style={{
        background: "rgba(255,255,255,0.96)", backdropFilter: "blur(14px)",
        borderTop: "1px solid #eceef3",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxShadow: "0 -4px 20px -8px rgba(15,15,26,.12)",
      }}>
      <div style={{ display: "flex", alignItems: "stretch", padding: "6px 0" }}>
        {tabs.map(tab => {
          const active = tab.to === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(tab.to);
          const Icon = tab.icon;
          const hasUnread = tab.to === "/chats" && unread > 0;
          return (
            <NavLink
              key={tab.to} to={tab.to}
              aria-label={t(tab.labelKey)}
              aria-current={active ? "page" : undefined}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: 52, textDecoration: "none", position: "relative",
                color: active ? "#25a896" : "#b0b4c8",
              }}>
              <div style={{ position: "relative" }}>
                <Icon size={27} strokeWidth={active ? 2.3 : 1.7} />
                {hasUnread && (
                  <span style={{
                    position: "absolute", top: -4, right: -5,
                    width: 9, height: 9, borderRadius: 999,
                    background: "#ef4444", border: "2px solid #fff",
                  }} />
                )}
              </div>
              {active && (
                <span style={{
                  position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)",
                  width: 4, height: 4, borderRadius: 999,
                  background: "#2BBFAA",
                }} />
              )}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
