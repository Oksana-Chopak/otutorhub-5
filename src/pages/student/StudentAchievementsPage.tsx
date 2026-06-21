import { useEffect } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { StudentAchievementsGrid } from "@/components/student/StudentAchievementsGrid";
import { useStudentRewards } from "@/hooks/useStudentRewards";
import { usePaywallTracking } from "@/hooks/usePaywallTracking";
import { SkeletonList } from "@/components/SkeletonCard";
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

  const total = achievements.length;
  const earnedN = earnedAchievements;
  const earned = achievements.filter((a) => a.earned);
  const locked = achievements.filter((a) => !a.earned);

  // "Next badge" hint: the closest unearned achievement by progress ratio.
  const nextUp = [...locked].sort(
    (x, y) => y.current / y.target - x.current / x.target,
  )[0];
  const nextRemaining = nextUp ? Math.max(nextUp.target - nextUp.current, 0) : 0;

  // SVG progress ring geometry (r=33, stroke 7).
  const R = 33;
  const C = 2 * Math.PI * R;
  const ringOffset = total > 0 ? C * (1 - earnedN / total) : C;

  return (
    <StudentLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="font-display text-[22px] font-extrabold text-foreground sm:text-2xl">
            {t("studentAchievements.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("studentAchievements.subtitle")}</p>
        </div>

        {loading ? (
          <SkeletonList count={3} />
        ) : (
          <>
            {/* Hero progress card (dark --grad-income) */}
            <div
              className="rounded-[20px] p-[18px] text-white shadow-md"
              style={{ background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 100%)" }}
            >
              <div className="flex items-center gap-4">
                {/* progress ring */}
                <div className="relative h-[76px] w-[76px] shrink-0">
                  <svg width="76" height="76" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="7" />
                    <circle
                      cx="38"
                      cy="38"
                      r={R}
                      fill="none"
                      stroke="#2BBFAA"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={C}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-[22px] font-extrabold leading-none text-white">{earnedN}</span>
                    <span className="font-display text-[14px] font-bold" style={{ color: "rgba(255,255,255,.55)" }}>
                      {t("studentAchievements.outOf", { total })}
                    </span>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg font-extrabold tracking-[-0.01em]">
                    {earnedN === 0
                      ? t("studentAchievements.heroEmptyTitle")
                      : t("studentAchievements.heroTitle")}
                  </div>
                  <div className="mt-0.5 text-[14.5px] leading-snug" style={{ color: "rgba(255,255,255,.7)" }}>
                    {earnedN === 0
                      ? t("studentAchievements.heroEmptyHint")
                      : nextUp
                        ? t("studentAchievements.heroNextHint", {
                            title: t(nextUp.def.nameKey),
                            remaining: nextRemaining,
                          })
                        : t("studentAchievements.heroAllDone")}
                  </div>
                </div>
              </div>
            </div>

            {/* Teal-tinted empty-state note */}
            {earnedN === 0 && (
              <div
                className="flex items-center gap-2.5 rounded-[14px] p-3.5"
                style={{
                  background: "rgba(43,191,170,.07)",
                  border: "1px solid rgba(43,191,170,.22)",
                }}
              >
                <span className="text-xl">🎯</span>
                <span className="text-[14.5px] leading-snug text-foreground">
                  {t("studentAchievements.emptyNote")}
                </span>
              </div>
            )}

            {/* Earned section */}
            {earnedN > 0 && (
              <div className="space-y-3">
                <div className="text-[14px] font-bold uppercase tracking-[0.09em]" style={{ color: "#9398b0" }}>
                  {t("studentAchievements.earnedSection", { n: earnedN })}
                </div>
                <StudentAchievementsGrid achievements={earned} />
              </div>
            )}

            {/* Locked / upcoming section */}
            {locked.length > 0 && (
              <div className="space-y-3">
                <div className="text-[14px] font-bold uppercase tracking-[0.09em]" style={{ color: "#9398b0" }}>
                  {earnedN > 0
                    ? t("studentAchievements.upcomingSection", { n: locked.length })
                    : t("studentAchievements.allSection", { n: locked.length })}
                </div>
                <StudentAchievementsGrid achievements={locked} />
              </div>
            )}
          </>
        )}
      </div>
    </StudentLayout>
  );
}
