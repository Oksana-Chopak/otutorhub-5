import { AppLayout } from "@/components/AppLayout";
import { BackToProfile } from "@/components/BackToProfile";
import { LevelBadge } from "@/components/LevelBadge";
import { BadgesGrid } from "@/components/BadgesGrid";
import { StreakCard } from "@/components/StreakCard";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { useTutorGamification } from "@/hooks/useTutorGamification";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { StudentRewardsShelf } from "@/components/StudentRewardsShelf";
import { StudentLayout } from "@/components/student/StudentLayout";

export default function AchievementsPage() {
  const { t } = useTranslation();
  const { roles } = useAuth();
  const isPureStudent = roles.includes("student") && !roles.includes("tutor") && !roles.includes("manager");
  const { level, streak, badges, loading } = useTutorGamification();

  if (isPureStudent) {
    return (
      <StudentLayout>
        <StudentRewardsShelf />
      </StudentLayout>
    );
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {level && <LevelBadge level={level} variant="full" />}
          <StreakCard streak={streak} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("achievements.title")}</CardTitle>
            <CardDescription>{t("achievements.badgesCollected", { count: badges.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <BadgesGrid earned={badges} />
          </CardContent>
        </Card>

        <MonthlySummaryCard />
      </div>
      <BackToProfile />
    </AppLayout>
  );
}
