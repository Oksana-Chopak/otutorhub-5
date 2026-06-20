import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Check, Lock } from "lucide-react";
import type {
  StudentAchievementTier,
  StudentAchievementWithStatus,
} from "@/lib/studentAchievements";

interface Props {
  achievements: StudentAchievementWithStatus[];
  className?: string;
}

// Tier-driven visuals (teal = base, gold = rare/harder). Gradients/glow match the
// approved spec; colours are DS tokens (teal #2BBFAA, gold #F5B544).
const TIER_GRADIENT: Record<StudentAchievementTier, string> = {
  teal: "linear-gradient(135deg,#7BE0CE,#2BBFAA)",
  gold: "linear-gradient(135deg,#FFE9A6,#F5B544)",
};
const TIER_GLOW: Record<StudentAchievementTier, string> = {
  teal: "0 10px 22px -10px rgba(43,191,170,.7)",
  gold: "0 10px 22px -10px rgba(245,181,68,.75)",
};
const TIER_RING: Record<StudentAchievementTier, string> = {
  teal: "rgba(43,191,170,.30)",
  gold: "rgba(245,181,68,.35)",
};
const TIER_EARNED_TEXT: Record<StudentAchievementTier, string> = {
  teal: "#25a896",
  gold: "#9a6a12",
};

/**
 * Student achievements grid — two-tier medal tiles per the approved spec.
 * earned   = colored gradient tile + glow + green ✓ check + "Здобуто" line.
 * unearned = muted tile (#eef0f4 / #c2c6d2 icon) + lock badge + progress bar + have/need.
 * The page renders this twice (Здобуті · N / Попереду · M) with filtered subsets.
 */
export function StudentAchievementsGrid({ achievements, className }: Props) {
  const { t } = useTranslation();

  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      {achievements.map(({ def, earned, current, target }) => {
        const tier = def.tier;
        const pct = target > 0 ? Math.round((Math.min(current, target) / target) * 100) : 0;
        return (
          <div
            key={def.key}
            className={cn(
              "relative flex flex-col items-center gap-[9px] rounded-[16px] bg-white px-2.5 pb-3.5 pt-4 text-center",
              earned && "shadow-sm",
            )}
            style={{ border: `1px solid ${earned ? TIER_RING[tier] : "#eceef3"}` }}
            title={t(def.descKey)}
          >
            {/* medal tile */}
            <div className="relative h-16 w-16 shrink-0">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-[20px] text-3xl"
                style={{
                  background: earned ? TIER_GRADIENT[tier] : "#eef0f4",
                  boxShadow: earned ? TIER_GLOW[tier] : "inset 0 0 0 1px #e6e8ee",
                  color: earned ? "#fff" : "#c2c6d2",
                  // muted emoji reads as a flat glyph when unearned
                  filter: earned ? undefined : "grayscale(1) opacity(0.55)",
                }}
              >
                {def.emoji}
              </div>

              {earned ? (
                <span
                  className="absolute -bottom-1 -right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full shadow-sm"
                  style={{ background: "#22c55e", border: "2px solid #fff" }}
                  aria-hidden
                >
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                </span>
              ) : (
                <span
                  className="absolute -bottom-1 -right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white shadow-sm"
                  style={{ border: "1px solid #eceef3" }}
                  aria-hidden
                >
                  <Lock className="h-3.5 w-3.5" style={{ color: "#b0b4c8" }} strokeWidth={2} />
                </span>
              )}
            </div>

            {/* title */}
            <div
              className="text-sm font-extrabold leading-tight"
              style={{ color: earned ? "#0f0f1a" : "#9398b0" }}
            >
              {t(def.nameKey)}
            </div>

            {/* earned line / progress */}
            {earned ? (
              <div
                className="inline-flex items-center gap-1 text-[13px] font-bold"
                style={{ color: TIER_EARNED_TEXT[tier] }}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
                {t("studentAchievements.earnedLabel")}
              </div>
            ) : (
              <div className="flex w-full flex-col items-center gap-1.5">
                <div
                  className="min-h-[31px] text-[13px] leading-snug"
                  style={{ color: "#b0b4c8" }}
                >
                  {t(def.descKey)}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#eef0f4" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: TIER_GRADIENT[tier] }}
                  />
                </div>
                <div className="text-[13px] font-bold tabular-nums" style={{ color: "#9398b0" }}>
                  {Math.min(current, target)} / {target}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
