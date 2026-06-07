/**
 * MobileBottomNav — 5-tab fixed bottom navigation.
 * Design: design_handoff_dashboard §6, mobile-independent-3.png
 * Tabs: Мій день · Розклад · Фінанси · Чати · Люди
 */
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, CalendarDays, Wallet, MessageSquare, Users } from "lucide-react";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/",          labelKey: "nav.dashboard", icon: Home },
  { to: "/schedule",  labelKey: "nav.schedule",  icon: CalendarDays },
  { to: "/finances",  labelKey: "nav.finances",  icon: Wallet },
  { to: "/chats",     labelKey: "nav.chats",     icon: MessageSquare },
  { to: "/people",    labelKey: "nav.people",    icon: Users },
] as const;

export function MobileBottomNav() {
  const { t } = useTranslation();
  const unread = useUnreadChats();
  const location = useLocation();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 lg:hidden"
      style={{ background: "rgba(255,255,255,0.94)", backdropFilter: "blur(14px)",
               borderTop: "1px solid var(--border,#eceef3)",
               paddingBottom: "env(safe-area-inset-bottom, 0px)",
               boxShadow: "0 -4px 20px -8px rgba(15,15,26,.12)" }}>
      <div style={{ display: "flex", alignItems: "stretch", padding: "8px 6px 4px" }}>
        {TABS.map(tab => {
          const active = tab.to === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(tab.to);
          const Icon = tab.icon;
          const hasUnread = tab.to === "/chats" && unread > 0;
          return (
            <NavLink
              key={tab.to} to={tab.to}
              style={{ flex: 1, border: "none", background: "transparent", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "5px 0", minHeight: 48, textDecoration: "none",
                color: active ? "var(--teal-d,#25a896)" : "var(--muted,#b0b4c8)" }}>
              <div style={{ position: "relative" }}>
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                {hasUnread && (
                  <span style={{ position: "absolute", top: -3, right: -4, width: 8, height: 8,
                    borderRadius: 999, background: "#ef4444", border: "1.5px solid #fff" }} />
                )}
              </div>
              <span style={{ fontFamily: "Inter, system-ui", fontWeight: active ? 700 : 600, fontSize: 10.5 }}>
                {t(tab.labelKey)}
              </span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
