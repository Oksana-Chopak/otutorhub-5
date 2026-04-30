import { Flame } from "lucide-react";
import { TutorStreak } from "@/hooks/useTutorGamification";
import { cn } from "@/lib/utils";

interface Props {
  streak: TutorStreak | null;
  className?: string;
}

export function StreakCard({ streak, className }: Props) {
  const current = streak?.current_streak ?? 0;
  const longest = streak?.longest_streak ?? 0;
  const toNextBonus = current >= 30 ? 0 : 30 - current;

  return (
    <div className={cn("rounded-2xl border border-border bg-gradient-to-br from-orange-500/10 to-rose-500/5 p-4", className)}>
      <div className="flex items-center gap-3">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white">
          <Flame className="h-7 w-7" />
          {current > 0 && (
            <span className="absolute -bottom-1 -right-1 flex h-6 min-w-[24px] items-center justify-center rounded-full bg-card px-1 text-xs font-bold text-foreground shadow">
              {current}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Серія днів</div>
          <div className="text-lg font-bold text-foreground">
            {current === 0 ? "Почни сьогодні!" : `${current} ${current === 1 ? "день" : current < 5 ? "дні" : "днів"} поспіль`}
          </div>
          {longest > current && (
            <div className="text-xs text-muted-foreground">Рекорд: {longest}</div>
          )}
        </div>
      </div>
      {toNextBonus > 0 && toNextBonus <= 14 && (
        <p className="mt-3 rounded-lg bg-card/50 p-2 text-xs text-foreground">
          🎁 Ще <strong>{toNextBonus}</strong> {toNextBonus === 1 ? "день" : "днів"} — і отримаєш <strong>+1 місяць Pro</strong> безкоштовно!
        </p>
      )}
      {current >= 30 && (
        <p className="mt-3 rounded-lg bg-success/10 p-2 text-xs text-success">
          🏆 Чудова серія! Ти отримав +1 місяць Pro.
        </p>
      )}
    </div>
  );
}
