import { Link, NavLink as RouterNavLink, useNavigate } from "react-router-dom";
import { CORE_TOTAL } from "@/lib/onboardingSteps";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  LayoutDashboard,
  BookOpen,
  CalendarDays,
  DollarSign,
  MessageSquare,
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
  MessageCircleHeart,
  Mail,
  ChevronLeft,
  UserRound,
  ChevronRight,
  AlertTriangle} from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { FeedbackDialog } from "@/components/FeedbackDialog";

type NavItem = {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
  badgeKey?: "availability" | "chats" | "subscription";
  independentOnly?: boolean;
  superadminOnly?: boolean;
};

// Single 5-item navigation per role. All other pages live under /profile.
const allNavItems: NavItem[] = [
  // Tutor
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["tutor"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["tutor"], badgeKey: "availability" },
  { to: "/my-students", labelKey: "nav.myStudents", icon: GraduationCap, roles: ["tutor"], independentOnly: true },
  { to: "/groups", labelKey: "nav.groups", icon: Users2, roles: ["tutor"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["tutor"], badgeKey: "chats" },
  { to: "/finances", labelKey: "nav.finances", icon: CreditCard, roles: ["tutor"] },
  { to: "/wallets", labelKey: "walletsPage.title", icon: Wallet, roles: ["tutor"], independentOnly: true }, // P5: був прихований
  // Достижения — for BOTH tutor kinds: the hub tutor's cabinet must feel as full
  // and motivating as the manager's (streak/level/badges are computed for them too).
  { to: "/achievements", labelKey: "nav.achievements", icon: Trophy, roles: ["tutor"] },
  { to: "/profile", labelKey: "nav.profile", icon: UserCircle, roles: ["tutor"] },
  // Manager
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["manager"] },
  { to: "/schedule", labelKey: "nav.schedule", icon: CalendarDays, roles: ["manager"], badgeKey: "availability" },
  { to: "/people", labelKey: "nav.people", icon: UserRound, roles: ["manager"] },
  { to: "/groups", labelKey: "nav.groups", icon: Users2, roles: ["manager"] },
  { to: "/chats", labelKey: "nav.chats", icon: MessageSquare, roles: ["manager"], badgeKey: "chats" },
  { to: "/finances", labelKey: "nav.finances", icon: CreditCard, roles: ["manager"] },
  { to: "/wallets", labelKey: "walletsPage.title", icon: Wallet, roles: ["manager"] },
  { to: "/marketing", labelKey: "nav.marketing", icon: Mail, roles: ["manager"] },
  { to: "/errors", labelKey: "nav.errors", icon: AlertTriangle, roles: ["manager"] },
  { to: "/admin", labelKey: "nav.admin", icon: BarChart3, roles: ["manager"], superadminOnly: true },
  { to: "/profile", labelKey: "nav.profile", icon: UserCircle, roles: ["manager"] },
  // Student — mirrors STUDENT_NAV_DEFS so the student rides the SAME AppSidebar as
  // every other role (was a separate light StudentLayout sidebar before).
  { to: "/student-dashboard", labelKey: "studentNav.dashboard", icon: LayoutDashboard, roles: ["student"] },
  { to: "/student/schedule", labelKey: "studentNav.schedule", icon: CalendarDays, roles: ["student"] },
  { to: "/student/payments", labelKey: "studentNav.payments", icon: DollarSign, roles: ["student"] },
  { to: "/student/homework", labelKey: "studentNav.homework", icon: BookOpen, roles: ["student"] },
  { to: "/chats", labelKey: "studentNav.chats", icon: MessageSquare, roles: ["student"], badgeKey: "chats" },
  { to: "/student/profile", labelKey: "studentNav.profile", icon: UserCircle, roles: ["student"] },
];

const roleLabelKey: Record<AppRole, string> = {
  manager: "roles.manager",
  tutor: "roles.tutor",
  student: "roles.student",
};

export function AppSidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Listen for toggle event dispatched by AppLayout header burger
  useEffect(() => {
    const handler = () => setOpen((o) => !o);
    window.addEventListener("toggleSidebar", handler);
    return () => window.removeEventListener("toggleSidebar", handler);
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, roles, signOut } = useAuth();
  const availabilityBadge = useAvailabilityRequestCount();
  const chatsBadge = useUnreadChats();
  const subscriptionBadge = useSubscriptionRequestCount();
  const { theme, toggleTheme } = useTheme();
  const { isIndependent, settings } = useWorkspaceSettings();
  const isTutorRole = roles.includes("tutor") && !roles.includes("manager");
  // The setup guide (/onboarding) is for EVERY tutor: independent tutors set up their own
  // workspace; hub tutors get the hub-scoped step set (OnboardingFlowB skips the
  // manager-owned steps). Show the entry to both, never to managers/students.
  const showOnboardingHelp = isTutorRole;

  // Platform superadmin (Oxy) — drives the /admin nav link only. Real enforcement is
  // server-side in the admin-stats edge function; this just shows/hides the entry.
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  useEffect(() => {
    if (!roles.includes("manager")) return;
    let active = true;
    // cast: is_superadmin enters generated types only after the migration is applied
    (supabase as any).rpc("is_superadmin").then(({ data }: { data: unknown }) => { if (active) setIsSuperadmin(data === true); });
    return () => { active = false; };
  }, [roles]);

  const navItems = allNavItems.filter((item) => {
    if (item.superadminOnly && !isSuperadmin) return false;
    if (!item.roles.some((r) => roles.includes(r))) return false;
    if (item.independentOnly && !isIndependent && !roles.includes("manager")) return false;
    return true;
  });

  const primaryRole = roles[0];
  const queryClient = useQueryClient();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Cached across pages/mounts via react-query — sidebar mounts on every route.
  const { data: profile = null } = useQuery({
    queryKey: ["sidebar-profile", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      return data as { first_name: string; last_name: string; avatar_url: string | null } | null;
    },
  });

  return (
    <>
      {/* Mobile burger is in AppLayout header */}

      {open && (
        <div
          className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-full flex-col border-r transition-all duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          sidebarCollapsed ? "w-[68px]" : "w-64"
        )}
        style={{
          background: "var(--dark-m)",
          borderColor: "rgba(255,255,255,0.07)",
          // Mobile overlay sidebar starts at the very top — clear the iOS notch (BUG-5)
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <Link
          to="/"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 py-4 transition-opacity hover:opacity-80"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: sidebarCollapsed ? "16px 14px" : "16px 24px" }}
          aria-label="oTutorHub"
        >
          <img src="/logo-96.webp" alt="oTutorHub" className="h-8 w-8 shrink-0" loading="lazy" />
          {!sidebarCollapsed && (
            <span className="font-display text-lg font-bold text-white">oTutorHub</span>
          )}
        </Link>

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
                ? "bg-primary px-1.5 text-[14px] font-semibold text-primary-foreground"
                : "bg-warning px-1.5 text-[14px] font-semibold text-warning-foreground";
            return (
              <RouterNavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-3 rounded-[12px] px-3 py-3 text-[17px] font-medium transition-all duration-150 lg:py-2.5 lg:text-[15.5px]",
                    isActive
                      ? "bg-[rgba(43,191,170,0.14)] text-[#2BBFAA] font-semibold"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Active accent bar — clear "you are here" cue */}
                    {isActive && !sidebarCollapsed && (
                      <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[#2BBFAA]" />
                    )}
                    {/* Icon box — lights up teal (with glow) when active; lifts on hover */}
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] transition-all duration-150 group-hover:bg-white/10"
                      style={
                        isActive
                          ? { background: "linear-gradient(135deg,#2BBFAA,#25a896)", boxShadow: "0 4px 12px -3px rgba(43,191,170,0.55)" }
                          : { background: "rgba(255,255,255,0.06)" }
                      }
                    >
                      <item.icon className={cn("h-[18px] w-[18px]", isActive && "text-[color:var(--ds-txt,#0f0f1a)]")} />
                    </div>
                    {!sidebarCollapsed && <span className="flex-1">{t(item.labelKey)}</span>}
                    {!sidebarCollapsed && badge > 0 && (
                      <span className={cn("ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full", badgeClass)}>
                        {badge}
                      </span>
                    )}
                    {sidebarCollapsed && badge > 0 && (
                      <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </>
                )}
              </RouterNavLink>
            );
          })}
        </nav>

        {/* Collapse toggle — desktop only */}
        <div className="hidden lg:flex justify-center py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(prev => !prev)}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            title={sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          >
            {sidebarCollapsed
              ? <ChevronRight className="h-4 w-4" />
              : <ChevronLeft className="h-4 w-4" />
            }
          </button>
        </div>

        {/* Help: setup guide (independent only) + feedback (everyone) — kept under the
            same "Допомога" heading so support is always in one place. */}
        <div className="px-3 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="mb-1.5 px-3 text-[15px] font-semibold uppercase tracking-wider text-slate-500">
            {t("nav.help")}
          </p>
          {showOnboardingHelp && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/onboarding");
              }}
              className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Sparkles className="h-4 w-4" />
              <span className="flex-1 text-left">{t("nav.setupGuide")}</span>
              {!settings?.onboarding_completed &&
                ((settings?.onboarding_step ?? 1) <= CORE_TOTAL) && (
                <span className="ml-auto inline-flex h-5 items-center justify-center rounded-full bg-[#2BBFAA] px-2 text-[14px] font-semibold text-white animate-pulse">
                  {t("nav.newBadge")}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setFeedbackOpen(true);
            }}
            className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <MessageCircleHeart className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("feedback.btn")}</span>
          </button>
        </div>

        <div className="px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center justify-center gap-3 pt-1 text-[14px] text-slate-500">
            <button type="button" onClick={() => { setOpen(false); navigate("/privacy"); }} className="underline hover:text-slate-300">{t("landing.footer.privacy")}</button>
            <span>·</span>
            <button type="button" onClick={() => { setOpen(false); navigate("/terms"); }} className="underline hover:text-slate-300">{t("landing.footer.terms")}</button>
          </div>
        </div>

        <div className="shrink-0 px-4 py-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          <div className="flex items-center gap-3">
            <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
              <DialogTrigger asChild>
                <button
                  className="rounded-full ring-offset-background transition hover:ring-2 hover:ring-[#2BBFAA]/40 hover:ring-offset-2"
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
              <DialogContent className="max-w-sm rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] overflow-y-auto">
                <div className="mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-border sm:hidden" />
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
                      queryClient.setQueryData<{ first_name: string; last_name: string; avatar_url: string | null } | null>(
                        ["sidebar-profile", user?.id],
                        (p) => (p ? { ...p, avatar_url: url } : p)
                      )
                    }
                  />
                )}
              </DialogContent>
            </Dialog>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {profile && (profile.first_name || profile.last_name)
                  ? `${profile.first_name} ${profile.last_name}`.trim()
                  : user?.email ?? "—"}
              </p>
              <p className="text-[14px] text-slate-400">
                {primaryRole ? t(roleLabelKey[primaryRole]) : t("roles.none")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start text-slate-400 hover:bg-white/5 hover:text-white"
              onClick={signOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t("common.logout")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="tap-44 h-9 w-9 shrink-0 text-slate-400 hover:bg-white/5 hover:text-white"
              onClick={toggleTheme}
              title={theme === "dark" ? t("theme.light") : t("theme.dark")}
              aria-label={t("theme.toggle")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <LanguageSwitcher variant="ghost" size="icon" showLabel={false} className="h-9 w-9 shrink-0 text-slate-400 hover:bg-white/5 hover:text-white" />
          </div>
        </div>
      </aside>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
