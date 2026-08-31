import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

/**
 * 42: реєстр «що далі» для учня. За взірцем DayBlock — рівно один стан,
 * одна підписана кнопка, ніколи не порожньо. Джерело: кроки 1–3 звіту
 * про мовчання (аудиторка, серпень 2026).
 */
interface StudentNextBlockProps {
  hasTutor: boolean;
  upcomingCount: number;
  nextStartsAt: string | null;   // ISO першого upcoming
  nextSubject: string | null;
  nextMeetingUrl: string | null;
  pendingPaymentsCount: number;
  homeworkCount: number;
  weeklyCount: number;
  weeklyRecord: number;
  lessonsBalance: number | null; // з wallet: null = не завантажено / не налаштовано
}

/** P7: картка — поза блоком, щоб не ремаунтувалась від батьківського стану. */
function Card({ emoji, title, sub, cta, onClick }: {
  emoji: string; title: string; sub?: string; cta: string; onClick: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 16px", borderRadius: 18,
      background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)",
      boxShadow: "0 14px 34px -18px rgba(15,15,26,.7)",
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 26 }}>{emoji}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: "Inter,system-ui,sans-serif", fontWeight: 800, fontSize: 16, color: "#fff" }}>{title}</span>
        {sub && <span style={{ display: "block", fontSize: 14, color: "rgba(255,255,255,.6)", marginTop: 1 }}>{sub}</span>}
      </span>
      <button type="button" onClick={onClick} style={{
        flexShrink: 0, height: 38, padding: "0 14px", borderRadius: 11,
        border: "none", cursor: "pointer",
        background: "linear-gradient(135deg,#2BBFAA,#25a896)",
        color: "#0f0f1a", fontFamily: "Inter,system-ui,sans-serif",
        fontWeight: 700, fontSize: 14,
        boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)",
      }}>{cta}</button>
    </div>
  );
}

export function StudentNextBlock(props: StudentNextBlockProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const state = useMemo(() => {
    const {
      hasTutor, upcomingCount, nextStartsAt, nextSubject, nextMeetingUrl,
      pendingPaymentsCount, homeworkCount, weeklyCount, weeklyRecord, lessonsBalance,
    } = props;

    // ── пріоритети: від термінового до стратегічного ──

    // 1. Нема тьютора
    if (!hasTutor) return {
      emoji: "🤝", key: "noTutor",
      title: t("studentNext.noTutorTitle"),
      sub: t("studentNext.noTutorSub"),
      cta: t("studentNext.noTutorCta"),
      to: "/student-dashboard", // FindTutorDialog відкривається на дашборді
    };

    // 2. Урок іде зараз (або ось-ось — у межах 15 хв) і є посилання
    if (nextStartsAt && nextMeetingUrl) {
      const startMs = new Date(nextStartsAt).getTime();
      const now = Date.now();
      if (now >= startMs - 15 * 60_000 && now < startMs + 90 * 60_000) {
        return {
          emoji: "🎥", key: "joinNow",
          title: nextSubject ?? t("studentNext.joinTitle"),
          sub: t("studentNext.joinSub"),
          cta: t("studentNext.joinCta"),
          href: nextMeetingUrl,
        };
      }
    }

    // 3. Борг оплати
    if (pendingPaymentsCount > 0) return {
      emoji: "💳", key: "debt",
      title: t("studentNext.debtTitle", { count: pendingPaymentsCount }),
      sub: t("studentNext.debtSub"),
      cta: t("studentNext.debtCta"),
      to: "/student/payments",
    };

    // 4. Є домашня завдання
    if (homeworkCount > 0) return {
      emoji: "📝", key: "homework",
      title: t("studentNext.homeworkTitle", { count: homeworkCount }),
      sub: t("studentNext.homeworkSub"),
      cta: t("studentNext.homeworkCta"),
      to: "/student/homework",
    };

    // 5. Передоплата закінчується (≤1 урок)
    if (lessonsBalance !== null && lessonsBalance <= 1 && lessonsBalance >= 0) return {
      emoji: "⚠️", key: "lowBalance",
      title: lessonsBalance === 0 ? t("studentNext.noBalanceTitle") : t("studentNext.lowBalanceTitle"),
      sub: lessonsBalance === 0 ? t("studentNext.noBalanceSub") : t("studentNext.lowBalanceSub"),
      cta: t("studentNext.balanceCta"),
      to: "/student/payments",
    };

    // 6. Серія перервана (цього тижня 0, але рекорд є)
    if (weeklyCount === 0 && weeklyRecord > 0) return {
      emoji: "🔥", key: "streakBroken",
      title: t("studentNext.streakBrokenTitle"),
      sub: t("studentNext.streakBrokenSub", { record: weeklyRecord }),
      cta: t("studentNext.streakBrokenCta"),
      to: "/student/schedule",
    };

    // 7. Наступний урок ще не скоро — підготуватись
    if (upcomingCount > 0) return {
      emoji: "📅", key: "upcoming",
      title: nextSubject ?? t("studentNext.upcomingTitle"),
      sub: nextStartsAt
        ? t("studentNext.upcomingSub", { date: new Date(nextStartsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) })
        : undefined,
      cta: t("studentNext.upcomingCta"),
      to: "/student/schedule",
    };

    // 8. Порожній розклад — запланувати
    return {
      emoji: "✨", key: "empty",
      title: t("studentNext.emptyTitle"),
      sub: t("studentNext.emptySub"),
      cta: t("studentNext.emptyCta"),
      to: "/student/schedule",
    };
  }, [props, t]);

  const handleClick = () => {
    if ("href" in state && state.href) {
      window.open(state.href, "_blank", "noopener,noreferrer");
    } else if ("to" in state) {
      navigate(state.to);
    }
  };

  return <Card emoji={state.emoji} title={state.title} sub={state.sub} cta={state.cta} onClick={handleClick} />;
}
