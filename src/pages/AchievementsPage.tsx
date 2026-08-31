import { BackToProfile } from "@/components/BackToProfile";
import { LevelBadge } from "@/components/LevelBadge";
import { BadgesGrid } from "@/components/BadgesGrid";
import { StreakCard } from "@/components/StreakCard";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { useTutorGamification } from "@/hooks/useTutorGamification";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { StudentRewardsShelf } from "@/components/StudentRewardsShelf";

export default function AchievementsPage() {
  const { t } = useTranslation();
  const { roles } = useAuth();
  const isPureStudent = roles.includes("student") && !roles.includes("tutor") && !roles.includes("manager");
  const { level, streak, badges, loading } = useTutorGamification();

  if (isPureStudent) {
    return (
      <>
        <StudentRewardsShelf />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-32 animate-pulse rounded-[18px] bg-muted" />
            <div className="h-32 animate-pulse rounded-[18px] bg-muted" />
          </div>
          <div className="space-y-3 rounded-[18px] border border-border bg-card p-5">
            <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-[16px] bg-muted" />
              ))}
            </div>
          </div>
          <div className="h-40 animate-pulse rounded-[18px] bg-muted" />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {level && <LevelBadge level={level} variant="full" />}
          <StreakCard streak={streak} />
        </div>

        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid #eceef3", background: "#fff", boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
          <div style={{ padding: "16px 18px 4px" }}>
            <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: "-.01em", color: "#0f0f1a" }}>{t("achievements.title")}</p>
            <p className="text-[15px]" style={{ color: "var(--sub,#666b82)", marginTop: 2 }}>{t("achievements.badgesCollected", { count: badges.length })}</p>
          </div>
          <div style={{ padding: "12px 18px 18px" }}>
            <BadgesGrid earned={badges} />
          </div>
        </div>

        <MonthlySummaryCard />
      </div>
      <BackToProfile />
    </>
  );
}
