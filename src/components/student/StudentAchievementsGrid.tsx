import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import type { StudentAchievementWithStatus } from "@/lib/studentAchievements";

interface Props {
  achievements: StudentAchievementWithStatus[];
  className?: string;
}

/**
 * Student achievements grid — mirrors the tutor BadgesGrid pattern:
 * earned = colorful (gradient + bounce), unearned = dashed/muted + lock.
 * Unearned threshold achievements (target > 1) also show a progress bar.
 */
export function StudentAchievementsGrid({ achievements, className }: Props) {
  const { t } = useTranslation();

  return (
    <div className={cn("grid grid-cols-3 gap-3 sm:grid-cols-6", className)}>
      {achievements.map(({ def, earned, current, target }) => {
        const showProgress = !earned && target > 1;
        const pct = target > 0 ? Math.round((current / target) * 100) : 0;
        return (
          <div
            key={def.key}
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-[18px] border p-3 text-center transition-all",
              earned
                ? "border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm hover:scale-105"
                : "border-dashed border-border bg-muted/30 opacity-60",
            )}
            title={t(def.descKey)}
          >
            {!earned && (
              <span className="absolute right-1.5 top-1.5 text-muted-foreground">
                <Lock className="h-3 w-3" />
              </span>
            )}
            <div className={cn("text-3xl", earned ? "animate-bounce-soft" : "opacity-50")}>{def.emoji}</div>
            <div className="text-[12px] font-extrabold leading-tight text-foreground">{t(def.nameKey)}</div>
            {showProgress && (
              <div className="mt-0.5 w-full">
                <div className="h-1.5 overflow-hidden rounded-full bg-border">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/80" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{current}/{target}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
