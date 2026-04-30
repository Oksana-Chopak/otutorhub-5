import { ALL_BADGES } from "@/lib/badges";
import { TutorBadge } from "@/hooks/useTutorGamification";
import { cn } from "@/lib/utils";

interface Props {
  earned: TutorBadge[];
  className?: string;
}

export function BadgesGrid({ earned, className }: Props) {
  const earnedKeys = new Set(earned.map((b) => b.badge_key));

  return (
    <div className={cn("grid grid-cols-3 gap-3 sm:grid-cols-6", className)}>
      {ALL_BADGES.map((badge) => {
        const isEarned = earnedKeys.has(badge.key);
        return (
          <div
            key={badge.key}
            className={cn(
              "flex flex-col items-center gap-1 rounded-2xl border p-3 text-center transition-all",
              isEarned
                ? "border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm hover:scale-105"
                : "border-dashed border-border bg-muted/30 opacity-50"
            )}
            title={badge.description}
          >
            <div className={cn("text-3xl", isEarned && "animate-bounce-soft")}>{badge.emoji}</div>
            <div className="text-[10px] font-medium leading-tight text-foreground">{badge.name}</div>
          </div>
        );
      })}
    </div>
  );
}
