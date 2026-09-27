import { Flame, MessageCircle, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { daysLeftInWeek } from "@/lib/studentGamification";
import type { StreakState, WeekGoal, WeeklyStreak } from "@/lib/studentGamification";

interface Props {
  streak: WeeklyStreak;
  state: StreakState;
  goal: WeekGoal;
  className?: string;
}

/**
 * Серія тижнів учня + ціль тижня (§4 аудиту шляхів 24.09: «немає щоденної цілі
 * й попередження "серія згорить"» — найдешевший спосіб повернення).
 *
 * Три свідомі межі:
 *  1. ОДИНИЦЯ — ТИЖДЕНЬ. Денна серія в продукті з уроками 1–2 рази на тиждень
 *     обривалась би постійно, тобто щодня повідомляла людині про поразку.
 *  2. Попередження зʼявляється ЛИШЕ коли є що робити: цього тижня уроку не
 *     було І жодного не заплановано. Тоді поруч стоїть дія — написати
 *     репетиторові (учень не ставить уроки сам). Попередження без дії вчить
 *     ігнорувати попередження.
 *  3. Жодне число не вигадується. Ціль по уроках = те, що СПРАВДІ у розкладі;
 *     якщо на тижні уроків немає, картка каже це словами, а не малює «0 з 1».
 */
export function StudentStreakCard({ streak, state, goal, className }: Props) {
  const { t } = useTranslation();
  // Людині, яка ще не провела жодного уроку, серія нічого не означає:
  // дашборд у цей момент веде її першим уроком, а не грою.
  if (streak.longest === 0) return null;

  const daysLeft = daysLeftInWeek();
  const atRisk = state === "atRisk";
  const lessonPct = goal.lessonsTarget > 0 ? Math.round((goal.lessonsDone / goal.lessonsTarget) * 100) : 0;
  const hwPct = goal.homeworkTarget > 0 ? Math.round((goal.homeworkDone / goal.homeworkTarget) * 100) : 0;

  return (
    <div
      className={className}
      style={{
        borderRadius: 18,
        border: "1px solid var(--ds-border,#eceef3)",
        background: "var(--ds-surface,#fff)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Серія */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white">
          <Flame className="h-7 w-7" />
          {streak.current > 0 && (
            <span
              className="absolute -bottom-1 -right-1 flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-[14px] font-bold shadow"
              style={{ background: "var(--ds-surface,#fff)", color: "var(--ds-txt,#0f0f1a)" }}
            >
              {streak.current}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--sub,#62677E)" }}>
            {t("studentStreak.title")}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ds-txt,#0f0f1a)" }}>
            {streak.current > 0
              ? t("studentStreak.weeks", { count: streak.current })
              : t("studentStreak.startTitle")}
          </div>
          {streak.longest > streak.current && (
            <div style={{ fontSize: 13, color: "var(--sub,#62677E)", marginTop: 2 }}>
              🏆 {t("studentStreak.record", { n: streak.longest })}
            </div>
          )}
        </div>
      </div>

      {/* Попередження — лише коли людина справді може врятувати серію */}
      {atRisk && (
        <div
          style={{
            borderRadius: 13,
            padding: "10px 13px",
            background: "linear-gradient(135deg, rgba(245,158,11,.14), rgba(245,158,11,.05))",
            border: "1px solid rgba(245,158,11,.3)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ds-txt,#0f0f1a)" }}>
                {daysLeft <= 1 ? t("studentStreak.atRiskToday") : t("studentStreak.atRiskSunday")}
              </div>
              <div style={{ fontSize: 14, color: "var(--sub,#62677E)", lineHeight: 1.45 }}>
                {t("studentStreak.atRiskHint", { count: daysLeft })}
              </div>
            </div>
          </div>
          {/* Учень не ставить уроки сам — єдина чесна дія веде до репетитора. */}
          <Link
            to="/chats"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--teal)] px-4 text-[15px] font-semibold text-white"
          >
            <MessageCircle className="h-4 w-4" />
            {t("studentStreak.writeTutor")}
          </Link>
        </div>
      )}

      {/* Ціль тижня */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--sub,#62677E)" }}>
          {t("studentStreak.weekTitle")}
        </div>
        {goal.lessonsTarget === 0 ? (
          <p style={{ fontSize: 14, color: "var(--sub,#62677E)", lineHeight: 1.45, margin: 0 }}>
            {t("studentStreak.noLessonsThisWeek")}
          </p>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 14, color: "var(--ds-txt,#0f0f1a)", fontWeight: 600 }}>{t("studentStreak.lessons")}</span>
              <span style={{ fontSize: 14, color: "var(--sub,#62677E)", fontWeight: 700 }}>
                {goal.lessonsDone} / {goal.lessonsTarget}
              </span>
            </div>
            <Progress value={lessonPct} className="h-2.5" />
          </div>
        )}
        {goal.homeworkTarget > 0 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 14, color: "var(--ds-txt,#0f0f1a)", fontWeight: 600 }}>{t("studentStreak.homework")}</span>
              <span style={{ fontSize: 14, color: "var(--sub,#62677E)", fontWeight: 700 }}>
                {goal.homeworkDone} / {goal.homeworkTarget}
              </span>
            </div>
            <Progress value={hwPct} className="h-2.5" />
          </div>
        )}
      </div>
    </div>
  );
}
