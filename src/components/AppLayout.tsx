import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AppSidebar } from "./AppSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { NotificationBell } from "./NotificationBell";
import { Menu } from "lucide-react";

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

  return (
    <div className="flex min-h-screen bg-background">
      {/* Offline banner — was imported but never rendered (so it never showed for any
          role). Rendered here so the whole app, every role, gets it. */}
      <OfflineBanner />
      <AppSidebar />
      <main className="flex-1 overflow-auto pb-20 lg:pb-0">
        {titleKey && (
          <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-border/60 bg-background/95 px-4 backdrop-blur lg:hidden">
            <h1 className="min-w-0 truncate font-display text-[17px] font-extrabold text-foreground">
              {t(titleKey)}
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
