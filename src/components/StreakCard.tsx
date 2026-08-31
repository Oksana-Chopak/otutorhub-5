import { Flame, Snowflake } from "lucide-react";
import { TutorStreak } from "@/hooks/useTutorGamification";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

interface Props {
  streak: TutorStreak | null;
  className?: string;
}

export function StreakCard({ streak, className }: Props) {
  const { t } = useTranslation();
  // MON-2: the streak's «+1 місяць підписки» bonus is an INDEPENDENT-tutor concept
  // (grant_pro_days). The card is also rendered for hub tutors (streak parity) —
  // they must see pure streak encouragement, never a subscription upsell.
  const { roles } = useAuth();
  const { isIndependent, loading: wsLoading } = useWorkspaceSettings();
  const showProBonus = !roles.includes("manager") && !wsLoading && isIndependent;
  const current = streak?.current_streak ?? 0;
  const longest = streak?.longest_streak ?? 0;
  const freezes = streak?.freezes_available ?? 0;
  const usedFreeze =
    !!streak?.last_freeze_used_at &&
    Date.now() - new Date(streak.last_freeze_used_at).getTime() < 7 * 24 * 60 * 60 * 1000;
  const toNextBonus = current >= 30 ? 0 : 30 - current;

  return (
    <div className={cn("rounded-[18px] border border-[var(--ds-border,#eceef3)] bg-gradient-to-br from-orange-500/10 to-rose-500/5 p-4", className)}>
      <div className="flex items-center gap-3">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white">
          <Flame className="h-7 w-7" />
          {current > 0 && (
            <span className="absolute -bottom-1 -right-1 flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-[14px] font-bold shadow" style={{ background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)" }}>
              {current}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[14px] uppercase tracking-wide" style={{ color: "var(--sub,#666b82)" }}>{t("streak.title")}</div>
            {/* Streak freeze indicator (Duolingo-style) */}
            <div
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[14px] font-medium",
                freezes > 0
                  ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                  : "bg-muted text-muted-foreground"
              )}
              title={
                freezes > 0
                  ? t("streak.freezeActive")
                  : t("streak.freezeNextMonth")
              }
            >
              <Snowflake className="h-3 w-3" style={freezes > 0 ? undefined : { color: "var(--sub,#666b82)" }} />
              {freezes} {freezes === 1 ? t("streak.freezeOne") : t("streak.freezeMany")}
            </div>
          </div>
          <div className="text-lg font-bold" style={{ color: "var(--ds-txt,#0f0f1a)", fontFamily: "Inter, system-ui, sans-serif" }}>
            {current === 0 ? t("streak.startToday") : t("streak.daysStreak", { count: current })}
          </div>
          {longest > current && (
            <div className="text-[14px]" style={{ color: "var(--sub,#666b82)" }}>{t("streak.record", { longest })}</div>
          )}
        </div>
      </div>

      {usedFreeze && (
        <p className="mt-3 rounded-lg bg-sky-500/10 p-2 text-[14px] text-sky-700 dark:text-sky-300">
          {t("streak.freezeUsed")}
        </p>
      )}
      {!usedFreeze && freezes === 0 && current > 0 && (
        <p className="mt-3 rounded-[10px] p-2 text-[14px]" style={{ background: "var(--ds-surface2,#fbfbfc)", color: "var(--sub,#666b82)", border: "1px solid var(--ds-border,#eceef3)" }}>
          {t("streak.noFreeze")}
        </p>
      )}
      {showProBonus && toNextBonus > 0 && toNextBonus <= 14 && (
        <p className="mt-3 rounded-[10px] p-2 text-[14px]" style={{ background: "#f0fdf9", color: "#1f8e7e" }}>
          {t("streak.daysToBonus", { count: toNextBonus })}
        </p>
      )}
      {showProBonus && current >= 30 && (
        <p className="mt-3 rounded-lg bg-success/10 p-2 text-[14px] text-success">
          {t("streak.bonusEarned")}
        </p>
      )}
    </div>
  );
}
