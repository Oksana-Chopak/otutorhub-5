import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import type { StudentReward } from "@/hooks/useStudentRewards";

interface Props {
  rewards: StudentReward[];
  loading: boolean;
}

export function RewardCollection({ rewards, loading }: Props) {
  const { t } = useTranslation();

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          {t("rewardCollection.title")}
        </h2>
        {rewards.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {rewards.length} {t("rewardCollection.countSuffix")}
          </span>
        )}
      </div>

      {loading ? null : rewards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rewardCollection.empty")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rewards.map((r) => (
            <div
              key={r.id}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/40 text-xl transition-transform hover:scale-110"
              title={new Date(r.earned_at).toLocaleDateString("uk-UA")}
            >
              {r.emoji}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
