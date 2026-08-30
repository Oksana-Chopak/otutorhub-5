import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AppSidebar } from "./AppSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { NotificationBell } from "./NotificationBell";
import { Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const routeTitleKey: Record<string, string> = {
  "/": "nav.dashboard",
  "/dashboard": "nav.dashboard",
  "/schedule": "nav.schedule",
  "/my-students": "nav.myStudents",
  "/profile": "nav.profile",
  "/subscription": "nav.subscription",
  "/finances": "nav.finances",
  "/wallets": "walletsPage.title",
  "/chats": "nav.chats",
  "/groups": "groupsPage.title",
  "/referrals": "nav.referrals",
  "/my-referrals": "myReferrals.heroTitle",
  "/achievements": "nav.achievements",
  "/subscription-requests": "nav.subscriptionRequests",
  "/people": "nav.people",
  "/paywall-metrics": "nav.paywallMetrics",
  "/errors": "nav.errors",
  "/admin": "nav.admin",
  "/audit": "nav.audit",
  "/onboarding": "nav.setupGuide",
  "/availability": "nav.availability",
  "/feedback-inbox": "feedbackInbox.title",
  "/marketing": "nav.marketing",
  // Student routes — now on the shared AppLayout chrome (was StudentLayout before)
  "/student-dashboard": "studentNav.myDashboard",
  "/student/schedule": "studentNav.schedule",
  "/student/payments": "studentNav.payments",
  "/student/homework": "studentNav.myHomework",
  "/student/profile": "studentNav.profile",
  "/student/achievements": "nav.achievements",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const titleKey = routeTitleKey[pathname];

  // Дашборд: замість статичного «Мій день» показуємо привітання прямо в
  // мобільному хедері (вимога 29.07 — звільнити перший екран під перший урок).
  // Правило лишається: мобільний заголовок рендерить ТІЛЬКИ AppLayout.
  const { user } = useAuth();
  const isDashboard = pathname === "/" || pathname === "/dashboard";
  const [firstName, setFirstName] = useState("");
  useEffect(() => {
    if (!isDashboard || !user) return;
    supabase
      .from("profiles")
      .select("first_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setFirstName((data?.first_name ?? "").trim()));
  }, [isDashboard, user?.id]);
  const hour = new Date().getHours();
  const greetKey = hour < 12 ? "dashboardExtra.greetingMorning" : hour < 18 ? "dashboardExtra.greetingDay" : "dashboardExtra.greetingEvening";
  const greetEmoji = hour < 12 ? "☀️" : hour < 18 ? "🌤️" : "🌙";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Offline banner — was imported but never rendered (so it never showed for any
          role). Rendered here so the whole app, every role, gets it. */}
      <OfflineBanner />
      <AppSidebar />
      {/* Desktop bell — ONE golden bell on EVERY page (spec: same style on every page).
          Before this, only 4 pages rendered their own lg bell; on People/Schedule/
          Finances/Chats/… notifications were unreachable on desktop. */}
      <div className="fixed right-6 top-6 z-40 hidden lg:block">
        <NotificationBell />
      </div>
      <main className="flex-1 overflow-auto pb-20 lg:pb-0">
        {titleKey && (
          <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-border/60 bg-background/95 px-4 backdrop-blur lg:hidden" style={{ height: "calc(52px + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <h1 className="min-w-0 truncate font-display text-[17px] font-extrabold text-foreground">
              {isDashboard ? (
                <span className="text-[16px] font-bold">
                  {greetEmoji} {t(greetKey)}
                  {firstName ? <>, <span style={{ color: "var(--teal,#2BBFAA)" }}>{firstName}</span></> : "!"}
                </span>
              ) : (
                t(titleKey)
              )}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              <NotificationBell />
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("toggleSidebar"))}
                className="flex h-11 w-11 items-center justify-center rounded-[14px] text-white"
                style={{ background: "var(--teal,#2BBFAA)" }}
                aria-label={t("nav.openMenu")}
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </header>
        )}
        <div className="mx-auto max-w-6xl px-4 pt-4 pb-6 lg:px-8 lg:pt-8 lg:py-8">
          {children}
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
