import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
  const prevRecord = useRef<number | null>(null);

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

  // Personal record celebration (skip first load)
  useEffect(() => {
    if (prevRecord.current === null) {
      prevRecord.current = weeklyRecord;
      return;
    }
    if (prevRecord.current < weeklyRecord && weeklyRecord > 0) {
      prevRecord.current = weeklyRecord;
      toast.success(t("studentRecord.weeklyNew"), { duration: 5000 });
    }
  }, [weeklyRecord, t]);

  return (
    <div style={{ borderRadius: 18, border: "1px solid #eceef3", background: "#fff", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Level + progress */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={`${colorClass}`} style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: "-.01em" }}>
            {t(`studentProgress.level_${level.key}`)}
          </span>
          {next && (
            <span style={{ fontSize: 14, color: "var(--sub,#6b7088)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 600 }}>
              {next.min - completedCount} {t("studentProgress.toNext")}
            </span>
          )}
        </div>
        <Progress value={progress} className="h-2.5" />
        <p style={{ marginTop: 6, fontSize: 14, color: "var(--sub,#6b7088)" }}>
          {t("studentProgress.progressTitle")}: <span style={{ color: "#0f0f1a", fontWeight: 700 }}>{completedCount}</span>{next ? ` / ${next.min}` : ""}
        </p>
      </div>

      {/* Weekly record */}
      {weeklyRecord > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: 13, padding: "10px 13px", background: "linear-gradient(135deg, rgba(245,181,68,.14), rgba(245,181,68,.05))", border: "1px solid rgba(245,181,68,.3)" }}>
          <span style={{ fontSize: 14.5, color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700 }}>
            🏆 {t("studentRecord.weeklyRecord", { count: weeklyRecord })}
          </span>
          <span style={{ fontSize: 14, color: "#9a6a12", fontWeight: 600 }}>
            {t("studentRecord.thisWeek", { count: weeklyCount })}
          </span>
        </div>
      )}
    </div>
  );
}
