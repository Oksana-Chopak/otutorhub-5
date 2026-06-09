/**
 * MobileBottomNav — 4 icons, no labels, large touch targets.
 * Люди перенесено в бокове меню (AppSidebar).
 */
import { NavLink, useLocation } from "react-router-dom";
import { Home, CalendarDays, Wallet, MessageSquare } from "lucide-react";
import { useUnreadChats } from "@/hooks/useUnreadChats";

const TABS = [
  { to: "/",          icon: Home },
  { to: "/schedule",  icon: CalendarDays },
  { to: "/finances",  icon: Wallet },
  { to: "/chats",     icon: MessageSquare },
] as const;

export function MobileBottomNav() {
  const unread = useUnreadChats();
  const location = useLocation();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 lg:hidden"
      style={{
        background: "rgba(255,255,255,0.96)", backdropFilter: "blur(14px)",
        borderTop: "1px solid var(--border,#eceef3)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxShadow: "0 -4px 20px -8px rgba(15,15,26,.12)"
      }}>
      <div style={{ display: "flex", alignItems: "stretch", padding: "6px 0" }}>
        {TABS.map(tab => {
          const active = tab.to === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(tab.to);
          const Icon = tab.icon;
          const hasUnread = tab.to === "/chats" && unread > 0;
          return (
            <NavLink
              key={tab.to} to={tab.to}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: 52, textDecoration: "none", position: "relative",
                color: active ? "var(--teal-d,#25a896)" : "var(--muted,#b0b4c8)",
              }}>
              <div style={{ position: "relative" }}>
                <Icon size={27} strokeWidth={active ? 2.3 : 1.7} />
                {hasUnread && (
                  <span style={{
                    position: "absolute", top: -4, right: -5,
                    width: 9, height: 9, borderRadius: 999,
                    background: "#ef4444", border: "2px solid #fff"
                  }} />
                )}
              </div>
              {active && (
                <span style={{
                  position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)",
                  width: 4, height: 4, borderRadius: 999,
                  background: "var(--teal,#2BBFAA)"
                }} />
              )}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
