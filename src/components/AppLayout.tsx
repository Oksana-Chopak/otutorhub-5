import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AppSidebar } from "./AppSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { NotificationBell } from "./NotificationBell";
import { UserCircle } from "lucide-react";

const routeTitleKey: Record<string, string> = {
  "/": "nav.dashboard",
  "/dashboard": "nav.dashboard",
  "/schedule": "nav.schedule",
  "/my-students": "nav.myStudents",
  "/profile": "nav.profile",
  "/subscription": "nav.subscription",
  "/analytics": "nav.analytics",
  "/finances": "nav.finances",
  "/chats": "nav.chats",
  "/referrals": "nav.referrals",
  "/my-referrals": "nav.myReferrals",
  "/achievements": "nav.achievements",
  "/subscription-requests": "nav.subscriptionRequests",
  "/people": "nav.people",
  "/paywall-metrics": "nav.paywallMetrics",
  "/audit": "nav.audit",
  "/onboarding": "nav.setupGuide",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const titleKey = routeTitleKey[pathname];

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto pb-20 lg:pb-0">
        {titleKey && (
          <header className="sticky top-0 z-20 flex h-11 items-center justify-between border-b border-border/60 bg-background/95 px-4 backdrop-blur lg:hidden">
            <h1 className="font-display text-sm font-semibold text-muted-foreground">
              {t(titleKey)}
            </h1>
            <div className="flex items-center gap-1">
              <NotificationBell className="h-8 w-8 border-0 bg-transparent hover:bg-secondary" />
              <Link
                to="/profile"
                aria-label={t("nav.profile")}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <UserCircle className="h-5 w-5" />
              </Link>
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
