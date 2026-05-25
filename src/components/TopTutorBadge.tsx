import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Trophy } from "lucide-react";

interface Props {
  percentile: number; // 0–100, e.g. 8 means "top 8%"
}

export function TopTutorBadge({ percentile }: Props) {
  const { t } = useTranslation();
  if (percentile >= 10) return null;

  const display = percentile <= 1 ? 1 : Math.floor(percentile);

  return (
    <Card className="flex items-center gap-4 border-amber-400/40 bg-gradient-to-r from-amber-50 to-yellow-50 p-4 dark:from-amber-950/30 dark:to-yellow-950/20">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-500">
        <Trophy className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">
          {t("tutorDelight.topTutorTitle", { pct: display })}
        </p>
        <p className="text-xs text-muted-foreground">{t("tutorDelight.topTutorDesc")}</p>
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-amber-400/20 px-2.5 py-1 text-xs font-bold text-amber-600">
        TOP {display}%
      </span>
    </Card>
  );
}
