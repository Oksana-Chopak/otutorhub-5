import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

/**
 * №6 (ідеї 01.09): учень в онбордингу розповідає мету/рівень/зручний час —
 * а репетитор і менеджер цього ніколи не бачили (дані читались лише як
 * count>0). Ця картка показує квіз на картці учня. RLS уже дозволяє:
 * менеджер читає все, репетитор — квізи учнів, з якими має student_rates.
 */
type QuizRow = {
  goal: string | null;
  goal_other: string | null;
  level: string | null;
  schedule: string[];
  subjects: string[];
};

const GOAL_KEY: Record<string, string> = {
  exam: "studentOnboarding.goalExam",
  work: "studentOnboarding.goalWork",
  self: "studentOnboarding.goalSelf",
  olympiad: "studentOnboarding.goalOlympiad",
  other: "studentOnboarding.goalOther",
};
const LEVEL_KEY: Record<string, string> = {
  beginner: "studentOnboarding.levelZero",
  intermediate: "studentOnboarding.levelBase",
  advanced: "studentOnboarding.levelDeepen",
};
const SLOT_KEY: Record<string, string> = {
  weekday_morning: "studentOnboarding.slotWeekMorning",
  weekday_day: "studentOnboarding.slotWeekDay",
  weekday_evening: "studentOnboarding.slotWeekEvening",
  weekend_morning: "studentOnboarding.slotWeekendMorning",
  weekend_day: "studentOnboarding.slotWeekendDay",
  weekend_evening: "studentOnboarding.slotWeekendEvening",
};

export function StudentGoalCard({ studentId, className }: { studentId: string; className?: string }) {
  const { t } = useTranslation();
  const [quiz, setQuiz] = useState<QuizRow | null | undefined>(undefined); // undefined = ще вантажиться

  useEffect(() => {
    let alive = true;
    setQuiz(undefined);
    void (async () => {
      const { data, error } = await supabase
        .from("student_intake_quiz")
        .select("goal, goal_other, level, schedule, subjects")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!alive) return;
      // Помилка чи порожньо — картки просто немає (квіз необовʼязковий).
      setQuiz(!error && data && data.length ? (data[0] as QuizRow) : null);
    })();
    return () => { alive = false; };
  }, [studentId]);

  if (!quiz) return null;

  const goalText =
    quiz.goal === "other" && quiz.goal_other?.trim()
      ? quiz.goal_other.trim()
      : quiz.goal
        ? t(GOAL_KEY[quiz.goal] ?? "", { defaultValue: quiz.goal })
        : null;
  const levelText = quiz.level ? t(LEVEL_KEY[quiz.level] ?? "", { defaultValue: quiz.level }) : null;
  const scheduleText = (quiz.schedule ?? [])
    .map((s) => t(SLOT_KEY[s] ?? "", { defaultValue: s }))
    .filter(Boolean)
    .join(", ");
  const subjectsText = (quiz.subjects ?? []).filter(Boolean).join(", ");

  const rows = [
    goalText ? { emoji: "🎯", text: goalText } : null,
    levelText ? { emoji: "📈", text: levelText } : null,
    scheduleText ? { emoji: "🗓", text: scheduleText } : null,
    subjectsText ? { emoji: "📚", text: subjectsText } : null,
  ].filter(Boolean) as Array<{ emoji: string; text: string }>;

  if (rows.length === 0) return null;

  return (
    <div
      className={`rounded-[16px] px-4 py-3 ${className ?? ""}`}
      style={{ background: "var(--teal-l,#f0fdf9)", border: "0.5px solid rgba(43,191,170,0.35)" }}
    >
      {/* Обидві теми: темно-зелений на світлому tint, яскраво-бірюзовий на темному */}
      <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#0F6E56] dark:text-[#7BE0CF]">
        {t("studentGoalCard.title")}
      </p>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <p key={r.emoji} className="flex items-start gap-2 text-[14px] leading-snug" style={{ color: "var(--ds-txt,#0f0f1a)" }}>
            <span aria-hidden className="shrink-0">{r.emoji}</span>
            <span className="min-w-0">{r.text}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
