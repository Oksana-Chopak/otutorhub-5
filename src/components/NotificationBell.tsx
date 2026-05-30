import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { cn } from "@/lib/utils";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";

function timeAgo(iso: string, t: (k: string, o?: object) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("time.justNow") as string;
  if (min < 60) return t("time.minutesAgo", { count: min }) as string;
  const h = Math.floor(min / 60);
  if (h < 24) return t("time.hoursAgo", { count: h }) as string;
  return t("time.daysAgo", { count: Math.floor(h / 24) }) as string;
}

const TYPE_ICON: Record<string, string> = {
  badge_unlocked: "🏆",
  lesson_request: "📅",
  lesson_cancelled: "❌",
  payout_confirmed: "💰",
  pro_request: "⭐",
  trial_ending: "⏰",
  onboarding_incomplete: "👋",
  monthly_recap: "📊",
  weekly_summary: "📈",
  streak_at_risk: "🔥",
  inactive: "👋",
};

interface Props {
  className?: string;
  golden?: boolean;
}

export function NotificationBell({ className, golden }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  const handleClick = async (n: AppNotification) => {
    if (!n.read) await markRead(n.id);
    if (n.link) navigate(n.link);
  };

  const displayed = notifications.slice(0, 10);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative h-11 w-11 shrink-0 rounded-full border-none", className)}
          aria-label={t("notifications.title")}
          style={{
            background: "radial-gradient(circle at 35% 30%, #ffd04a, #f59e0b 60%, #d97706)",
            boxShadow: "0 4px 14px rgba(245,158,11,0.4), inset 0 1px 0 rgba(255,255,255,0.3)",
          }}
        >
          <Bell className="h-5 w-5 text-white" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))" }} />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white border-2 border-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">
            {t("notifications.title")}
          </span>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-primary hover:underline"
            >
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-[400px] overflow-y-auto">
          {displayed.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-3xl mb-2">✨</div>
              <p className="text-[15px] font-semibold text-foreground">{t("notifications.empty")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{t("notifications.emptyDesc")}</p>
            </div>
          ) : (
            <ul>
              {displayed.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">
                      {TYPE_ICON[n.type] ?? "🔔"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm leading-snug text-foreground", !n.read && "font-medium")}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        {timeAgo(n.created_at, t)}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border px-3 py-2">
          <PushNotificationToggle />
        </div>
      </PopoverContent>
    </Popover>
  );
}
