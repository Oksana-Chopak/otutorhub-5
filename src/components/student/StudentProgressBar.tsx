import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getLevelProgress } from "@/lib/rewardThemes";

interface Props {
  completedCount: number;
  weeklyCount: number;
  weeklyRecord: number;
}

const LEVEL_COLORS: Record<string, string> = {
  novice:  "text-muted-foreground",
  student: "text-blue-500",
  expert:  "text-violet-500",
  master:  "text-amber-500",
  legend:  "text-primary",
};

export function StudentProgressBar({ completedCount, weeklyCount, weeklyRecord }: Props) {
  const { t } = useTranslation();
  const prevLevelKey = useRef<string | null>(null);
  const prevRecord = useRef<number>(weeklyRecord);

  const { level, next, progress } = getLevelProgress(completedCount);
  const colorClass = LEVEL_COLORS[level.key] ?? "text-foreground";

  // Level-up celebration
  useEffect(() => {
    if (prevLevelKey.current === null) {
      prevLevelKey.current = level.key;
      return;
    }
    if (prevLevelKey.current !== level.key) {
      prevLevelKey.current = level.key;
      toast.success(t("studentProgress.levelUp", { level: t(`studentProgress.level_${level.key}`) }), {
        duration: 6000,
      });
    }
  }, [level.key, t]);

  // Personal record celebration
  useEffect(() => {
    if (prevRecord.current < weeklyRecord && weeklyRecord > 0) {
      prevRecord.current = weeklyRecord;
      toast.success(t("studentRecord.weeklyNew"), { duration: 5000 });
    }
  }, [weeklyRecord, t]);

  return (
    <Card className="p-5 space-y-4">
      {/* Level + progress */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className={`font-semibold ${colorClass}`}>
            {t(`studentProgress.level_${level.key}`)}
          </span>
          {next && (
            <span className="text-xs text-muted-foreground">
              {next.min - completedCount} {t("studentProgress.toNext")}
            </span>
          )}
        </div>
        <Progress value={progress} className="h-2" />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("studentProgress.progressTitle")}: {completedCount}{next ? ` / ${next.min}` : ""}
        </p>
      </div>

      {/* Weekly record */}
      {weeklyRecord > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
          <span className="text-sm text-foreground">
            {t("studentRecord.weeklyRecord", { count: weeklyRecord })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("studentRecord.thisWeek", { count: weeklyCount })}
          </span>
        </div>
      )}
    </Card>
  );
}
