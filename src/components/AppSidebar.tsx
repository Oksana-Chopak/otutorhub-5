import { NavLink as RouterNavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
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

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
  badgeKey?: "availability" | "chats" | "subscription";
  independentOnly?: boolean;
};

const allNavItems: NavItem[] = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard, roles: ["manager", "tutor", "student"] },
  { to: "/schedule", label: "Розклад", icon: CalendarDays, roles: ["manager", "tutor", "student"] },
  { to: "/my-students", label: "Мої учні", icon: GraduationCap, roles: ["tutor"], independentOnly: true },
  { to: "/profile", label: "Мій профіль", icon: UserCircle, roles: ["tutor"] },
  { to: "/onboarding", label: "Онбординг", icon: Sparkles, roles: ["tutor"], independentOnly: true },
  { to: "/subscription", label: "Підписка", icon: Crown, roles: ["tutor"], independentOnly: true },
  { to: "/availability", label: "Доступні години", icon: CalendarClock, roles: ["manager", "tutor"], badgeKey: "availability" },
  { to: "/finances", label: "Фінанси", icon: DollarSign, roles: ["manager"] },
  { to: "/chats", label: "Чати", icon: MessageSquare, roles: ["manager", "tutor", "student"], badgeKey: "chats" },
    { to: "/referrals", label: "Запити на репетиторів", icon: HandHeart, roles: ["manager"] },
    { to: "/subscription-requests", label: "Запити на підписку", icon: Crown, roles: ["manager"], badgeKey: "subscription" },
    { to: "/people", label: "Люди", icon: Users, roles: ["manager"] },
    { to: "/audit", label: "Аудит", icon: ShieldAlert, roles: ["manager"] },
];

const roleLabel: Record<AppRole, string> = {
  manager: "Менеджер",
  tutor: "Репетитор",
  student: "Учень",
};

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const { user, roles, signOut } = useAuth();
  const availabilityBadge = useAvailabilityRequestCount();
  const chatsBadge = useUnreadChats();
  const subscriptionBadge = useSubscriptionRequestCount();
  const { theme, toggleTheme } = useTheme();
  const { isIndependent } = useWorkspaceSettings();

  const navItems = allNavItems.filter((item) => {
    if (!item.roles.some((r) => roles.includes(r))) return false;
    if (item.independentOnly && !isIndependent && !roles.includes("manager")) return false;
    return true;
  });

  const primaryRole = roles[0];
  const initials = (user?.email ?? "??").slice(0, 2).toUpperCase();
  const [profile, setProfile] = useState<{ first_name: string; last_name: string; avatar_url: string | null } | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);

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
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-card p-2 shadow-md lg:hidden"
        aria-label="Toggle menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
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

        <nav className="flex-1 space-y-1 px-3 py-4">
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
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )
                }
                end={item.to === "/"}
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className={cn("ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full", badgeClass)}>
                    {badge}
                  </span>
                )}
              </RouterNavLink>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
              <DialogTrigger asChild>
                <button
                  className="rounded-full ring-offset-background transition hover:ring-2 hover:ring-primary/40 hover:ring-offset-2"
                  title="Змінити фото"
                  aria-label="Змінити фото профілю"
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
                  <DialogTitle>Фото профілю</DialogTitle>
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
                {primaryRole ? roleLabel[primaryRole] : "Без ролі"}
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
              Вийти
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={toggleTheme}
              title={theme === "dark" ? "Світла тема" : "Темна тема"}
              aria-label="Перемкнути тему"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
