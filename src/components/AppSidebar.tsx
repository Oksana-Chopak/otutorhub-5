import { NavLink as RouterNavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  LayoutDashboard,
  CalendarDays,
  DollarSign,
  MessageSquare,
  Users,
  Menu,
  X,
  LogOut,
  CalendarClock,
  ShieldAlert,
  Sun,
  Moon,
  GraduationCap,
  Sparkles,
  HandHeart,
  UserCircle,
  Crown,
  HelpCircle,
  BarChart3,
  Trophy,
  Wallet,
  Users2,
  CreditCard,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useAvailabilityRequestCount } from "@/hooks/useAvailabilityRequestCount";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { useSubscriptionRequestCount } from "@/hooks/useSubscriptionRequestCount";
import { useTheme } from "@/hooks/useTheme";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/UserAvatar";
import { AvatarUploader } from "@/components/AvatarUploader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { OnboardingDialog } from "@/components/OnboardingDialog";

type NavItem = {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
  badgeKey?: "availability" | "chats" | "subscription";
  independentOnly?: boolean;
};

// Single 5-item navigation per role. All other pages live under /profile.
const allNavItems: NavItem[] = [
  // Tutor
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["tutor"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["tutor"], badgeKey: "availability" },
  { to: "/my-students", labelKey: "nav.myStudents", icon: GraduationCap, roles: ["tutor"] },
  { to: "/groups", labelKey: "nav.groups", icon: Users2, roles: ["tutor"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["tutor"], badgeKey: "chats" },
  { to: "/finances", labelKey: "nav.finances", icon: CreditCard, roles: ["tutor"] },
  { to: "/profile", labelKey: "nav.profile", icon: UserCircle, roles: ["tutor"] },
  // Manager
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["manager"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["manager"], badgeKey: "availability" },
  { to: "/people", labelKey: "nav.people", icon: Users, roles: ["manager"] },
  { to: "/groups", labelKey: "nav.groups", icon: Users2, roles: ["manager"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["manager"], badgeKey: "chats" },
  { to: "/finances", labelKey: "nav.finances", icon: CreditCard, roles: ["manager"] },
  { to: "/profile", labelKey: "nav.profile", icon: UserCircle, roles: ["manager"] },
  // Student
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["student"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["student"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["student"], badgeKey: "chats" },
  { to: "/student/profile", labelKey: "nav.profile", icon: UserCircle, roles: ["student"] },
];

const roleLabelKey: Record<AppRole, string> = {
  manager: "roles.manager",
  tutor: "roles.tutor",
  student: "roles.student",
};

export function AppSidebar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { user, roles, signOut } = useAuth();
  const availabilityBadge = useAvailabilityRequestCount();
  const chatsBadge = useUnreadChats();
  const subscriptionBadge = useSubscriptionRequestCount();
  const { theme, toggleTheme } = useTheme();
  const { isIndependent, settings } = useWorkspaceSettings();
  const isTutorRole = roles.includes("tutor") && !roles.includes("manager");
  const showOnboardingHelp = isTutorRole && (!isIndependent || !settings?.onboarding_completed);

  const navItems = allNavItems.filter((item) => {
    if (!item.roles.some((r) => roles.includes(r))) return false;
    if (item.independentOnly && !isIndependent && !roles.includes("manager")) return false;
    return true;
  });

  const primaryRole = roles[0];
  const [profile, setProfile] = useState<{ first_name: string; last_name: string; avatar_url: string | null } | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setProfile(data);
      });
  }, [user?.id]);

  return (
    <>
      {/* Mobile FAB toggle — bottom-right, large tap target */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-24 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 lg:hidden"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
      >
        {open ? <X className="h-7 w-7" /> : <Menu className="h-7 w-7" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-6 py-5">
          <img src="/logo.png" alt="oTutorHub" className="h-8 w-8" />
          <span className="font-display text-lg font-bold text-foreground">
            oTutorHub
          </span>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const badge =
              item.badgeKey === "availability"
                ? availabilityBadge
                : item.badgeKey === "chats"
                ? chatsBadge
                : item.badgeKey === "subscription"
                ? subscriptionBadge
                : 0;
            const badgeClass =
              item.badgeKey === "chats"
                ? "bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground"
                : "bg-warning px-1.5 text-[10px] font-semibold text-warning-foreground";
            return (
              <RouterNavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors lg:py-2.5 lg:text-sm",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )
                }
                end={item.to === "/"}
              >
                <item.icon className="h-5 w-5 lg:h-4 lg:w-4" />
                <span className="flex-1">{t(item.labelKey)}</span>
                {badge > 0 && (
                  <span className={cn("ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full", badgeClass)}>
                    {badge}
                  </span>
                )}
              </RouterNavLink>
            );
          })}
        </nav>

        {showOnboardingHelp && (
          <div className="border-t border-border px-3 py-3">
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("nav.help")}
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setOnboardingOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Sparkles className="h-4 w-4" />
              <span className="flex-1 text-left">{t("nav.setupGuide")}</span>
              {isIndependent && !settings?.onboarding_completed && (
                <span className="ml-auto inline-flex h-5 items-center justify-center rounded-full bg-primary px-2 text-[10px] font-semibold text-primary-foreground animate-pulse">
                  {t("nav.newBadge") || "Новий!"}
                </span>
              )}
            </button>
          </div>
        )}

        <div className="shrink-0 border-t border-border px-4 py-4 space-y-3" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          <div className="flex items-center gap-3">
            <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
              <DialogTrigger asChild>
                <button
                  className="rounded-full ring-offset-background transition hover:ring-2 hover:ring-primary/40 hover:ring-offset-2"
                  title={t("profile.changePhoto")}
                  aria-label={t("profile.changePhoto")}
                >
                  <UserAvatar
                    url={profile?.avatar_url}
                    firstName={profile?.first_name || user?.email?.[0]?.toUpperCase() || ""}
                    lastName={profile?.last_name}
                    className="h-9 w-9"
                  />
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>{t("profile.profilePhoto")}</DialogTitle>
                </DialogHeader>
                {user && (
                  <AvatarUploader
                    userId={user.id}
                    currentUrl={profile?.avatar_url}
                    firstName={profile?.first_name}
                    lastName={profile?.last_name}
                    onChanged={(url) =>
                      setProfile((p) => (p ? { ...p, avatar_url: url } : p))
                    }
                  />
                )}
              </DialogContent>
            </Dialog>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {profile && (profile.first_name || profile.last_name)
                  ? `${profile.first_name} ${profile.last_name}`.trim()
                  : user?.email ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {primaryRole ? t(roleLabelKey[primaryRole]) : t("roles.none")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 justify-start"
              onClick={signOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t("common.logout")}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={toggleTheme}
              title={theme === "dark" ? t("theme.light") : t("theme.dark")}
              aria-label={t("theme.toggle")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <LanguageSwitcher variant="outline" size="icon" showLabel={false} className="h-9 w-9 shrink-0" />
          </div>
        </div>
      </aside>
      <OnboardingDialog open={onboardingOpen} onOpenChange={setOnboardingOpen} />
    </>
  );
}
