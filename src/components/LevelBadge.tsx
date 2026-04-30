import { TutorLevel } from "@/hooks/useTutorGamification";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface Props {
  level: TutorLevel;
  variant?: "compact" | "full";
  className?: string;
}

export function LevelBadge({ level, variant = "compact", className }: Props) {
  if (variant === "compact") {
    return (
      <div className={cn("inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary", className)}>
        <span className="text-base leading-none">{level.emoji}</span>
        <span>{level.name}</span>
      </div>
    );
  }

  const progress =
    level.next_threshold && level.next_threshold > 0
      ? Math.min(100, Math.round((level.completed_lessons / level.next_threshold) * 100))
      : 100;

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-3xl">
          {level.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Твій рівень</div>
          <div className="text-lg font-bold text-foreground">{level.name}</div>
        </div>
      </div>
      {level.next_threshold ? (
        <>
          <Progress value={progress} className="h-2" />
          <p className="mt-2 text-xs text-muted-foreground">
            {level.completed_lessons} / {level.next_threshold} уроків до наступного рівня
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Максимальний рівень досягнуто 🎉</p>
      )}
    </div>
  );
}
