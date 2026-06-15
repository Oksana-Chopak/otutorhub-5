import { AppLayout } from "@/components/AppLayout";
import { BackToProfile } from "@/components/BackToProfile";
import { LevelBadge } from "@/components/LevelBadge";
import { BadgesGrid } from "@/components/BadgesGrid";
import { StreakCard } from "@/components/StreakCard";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { useTutorGamification } from "@/hooks/useTutorGamification";
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

        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid #eceef3", background: "#fff", boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
          <div style={{ padding: "16px 18px 4px" }}>
            <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("achievements.title")}</p>
            <p className="text-[13.5px]" style={{ color: "#6b7088", marginTop: 2 }}>{t("achievements.badgesCollected", { count: badges.length })}</p>
          </div>
          <div style={{ padding: "12px 18px 18px" }}>
            <BadgesGrid earned={badges} />
          </div>
        </div>

        <MonthlySummaryCard />
      </div>
      <BackToProfile />
    </AppLayout>
  );
}
