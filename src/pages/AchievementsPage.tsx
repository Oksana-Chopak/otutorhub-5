import { BackToProfile } from "@/components/BackToProfile";
import { useRoleFlags } from "@/hooks/useRoleFlags";
import { canSee } from "@/lib/roleCapabilities";
import { useAwardBadges } from "@/hooks/useAwardBadges";
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
  const { flags, ready: roleReady } = useRoleFlags();
  const canSeeMoney = canSee("moneySummary", flags);
  const gamification = useTutorGamification();
  const { level, streak, badges, loading } = gamification;
  // Перевірка 01.09: тост про бейдж веде саме сюди — сторінка мусить нараховувати
  // сама, інакше той, хто прийшов за тостом, бачить стару сітку.
  // Менеджер без ролі tutor отримає від RPC порожній результат — не кличемо.
  useAwardBadges(!isPureStudent && !loading && roleReady, gamification.refresh);

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

        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
          <div style={{ padding: "16px 18px 4px" }}>
            <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: "-.01em", color: "var(--ds-txt,#0f0f1a)" }}>{t("achievements.title")}</p>
            <p className="text-[15px]" style={{ color: "var(--sub,#666b82)", marginTop: 2 }}>{t("achievements.badgesCollected", { count: badges.length })}</p>
          </div>
          <div style={{ padding: "12px 18px 18px" }}>
            <BadgesGrid earned={badges} />
          </div>
        </div>

        {/* Аудит 02.09: картка показує «% оплат вчасно» — для хабового це гроші
            ШКОЛИ. На дашборді вона гейтилась, тут гейта не було зовсім. Тепер
            це рядок матриці ролей (moneySummary), а не окремий прапорець. */}
        {roleReady && canSeeMoney && <MonthlySummaryCard />}
      </div>
      <BackToProfile />
    </>
  );
}
