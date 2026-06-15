import { useEffect } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentAchievementsGrid } from "@/components/student/StudentAchievementsGrid";
import { useStudentRewards } from "@/hooks/useStudentRewards";
import { usePaywallTracking } from "@/hooks/usePaywallTracking";
import { Loader2, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function StudentAchievementsPage() {
  const { t } = useTranslation();
  const { achievements, earnedAchievements, loading } = useStudentRewards();
  const { trackPaywallClick } = usePaywallTracking();

  // Product analytics: record an achievements-page view (student is authed here).
  useEffect(() => {
    trackPaywallClick("achievements_view", "achievements_page");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StudentLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{t("studentAchievements.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("studentAchievements.subtitle")}</p>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card className="rounded-[16px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                {t("studentAchievements.collected", { count: earnedAchievements, total: achievements.length })}
              </CardTitle>
              <CardDescription>{t("studentAchievements.hint")}</CardDescription>
            </CardHeader>
            <CardContent>
              {earnedAchievements === 0 && (
                <p className="mb-4 rounded-xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">
                  {t("studentAchievements.empty")}
                </p>
              )}
              <StudentAchievementsGrid achievements={achievements} />
            </CardContent>
          </Card>
        )}
      </div>
    </StudentLayout>
  );
}
