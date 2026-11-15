import { useMemo } from "react";
import { getLocale } from "@/lib/locale";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GAMIFICATION_VISIBLE } from "@/lib/gamification";

/**
 * 42: реєстр «що далі» для учня. За взірцем DayBlock — рівно один стан,
 * одна підписана кнопка, ніколи не порожньо. Джерело: кроки 1–3 звіту
 * про мовчання (аудиторка, серпень 2026).
 */
export interface StudentNextBlockProps {
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
      {/* Аудит 05.09: 44px ВІЗУАЛЬНО, не лише хіт-зоною (.tap-44) — це
          найголовніша кнопка дня учня, її тиснуть поспіхом з телефона. */}
      <button className="tap-44" type="button" onClick={onClick} style={{
        flexShrink: 0, height: 44, padding: "0 16px", borderRadius: 12,
        border: "none", cursor: "pointer",
        background: "linear-gradient(135deg,#2BBFAA,#25a896)",
        color: "#0f0f1a", fontFamily: "Inter,system-ui,sans-serif",
        fontWeight: 700, fontSize: 14,
        boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)",
      }}>{cta}</button>
    </div>
  );
}

export type StudentNextKey =
  | "noTutor" | "joinNow" | "debt" | "homework" | "lowBalance" | "streakBroken" | "upcoming" | "empty";

/**
 * 15.11: ЯКИЙ стан показує блок — окремою чистою функцією, щоб кабінет не дублював
 * під блоком те саме число плиткою («💳 8 уроків без оплати → Оплатити», а нижче ще
 * «ОЧІКУЮТЬ ОПЛАТИ 8»). Пріоритети — від термінового до стратегічного.
 */
export function pickStudentNext(p: StudentNextBlockProps, now = Date.now()): StudentNextKey {
  if (!p.hasTutor) return "noTutor";
  if (p.nextStartsAt && p.nextMeetingUrl) {
    const startMs = new Date(p.nextStartsAt).getTime();
    if (now >= startMs - 15 * 60_000 && now < startMs + 90 * 60_000) return "joinNow";
  }
  if (p.pendingPaymentsCount > 0) return "debt";
  if (p.homeworkCount > 0) return "homework";
  if (p.lessonsBalance !== null && p.lessonsBalance <= 1 && p.lessonsBalance >= 0) return "lowBalance";
  // Серії — гейміфікація (рішення ради 01.11, src/lib/gamification).
  if (GAMIFICATION_VISIBLE && p.weeklyCount === 0 && p.weeklyRecord > 0) return "streakBroken";
  if (p.upcomingCount > 0) return "upcoming";
  return "empty";
}

export function StudentNextBlock(props: StudentNextBlockProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const state = useMemo(() => {
    const { nextStartsAt, nextSubject, nextMeetingUrl, pendingPaymentsCount, homeworkCount, weeklyRecord, lessonsBalance } = props;
    switch (pickStudentNext(props)) {
      case "noTutor": return {
        emoji: "🤝", key: "noTutor",
        title: t("studentNext.noTutorTitle"),
        sub: t("studentNext.noTutorSub"),
        cta: t("studentNext.noTutorCta"),
        to: "/student-dashboard", // FindTutorDialog відкривається на дашборді
      };
      case "joinNow": return {
        emoji: "🎥", key: "joinNow",
        title: nextSubject ?? t("studentNext.joinTitle"),
        sub: t("studentNext.joinSub"),
        cta: t("studentNext.joinCta"),
        href: nextMeetingUrl ?? undefined,
      };
      case "debt": return {
        emoji: "💳", key: "debt",
        title: t("studentNext.debtTitle", { count: pendingPaymentsCount }),
        sub: t("studentNext.debtSub"),
        cta: t("studentNext.debtCta"),
        to: "/student/payments",
      };
      case "homework": return {
        emoji: "📝", key: "homework",
        title: t("studentNext.homeworkTitle", { count: homeworkCount }),
        sub: t("studentNext.homeworkSub"),
        cta: t("studentNext.homeworkCta"),
        to: "/student/homework",
      };
      case "lowBalance": return {
        emoji: "⚠️", key: "lowBalance",
        title: lessonsBalance === 0 ? t("studentNext.noBalanceTitle") : t("studentNext.lowBalanceTitle"),
        sub: lessonsBalance === 0 ? t("studentNext.noBalanceSub") : t("studentNext.lowBalanceSub"),
        cta: t("studentNext.balanceCta"),
        to: "/student/payments",
      };
      case "streakBroken": return {
        emoji: "🔥", key: "streakBroken",
        title: t("studentNext.streakBrokenTitle"),
        sub: t("studentNext.streakBrokenSub", { record: weeklyRecord }),
        cta: t("studentNext.streakBrokenCta"),
        to: "/student/schedule",
      };
      case "upcoming": return {
        emoji: "📅", key: "upcoming",
        title: nextSubject ?? t("studentNext.upcomingTitle"),
        sub: nextStartsAt
          ? t("studentNext.upcomingSub", { date: new Date(nextStartsAt).toLocaleDateString(getLocale(), { weekday: "short", day: "numeric", month: "short" }) })
          : undefined,
        cta: t("studentNext.upcomingCta"),
        to: "/student/schedule",
      };
      default: return {
        emoji: "✨", key: "empty",
        title: t("studentNext.emptyTitle"),
        sub: t("studentNext.emptySub"),
        cta: t("studentNext.emptyCta"),
        to: "/student/schedule",
      };
    }
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
