import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import {
  computeStudentAchievements,
  maxConsecutiveWeeks,
  type StudentAchievementWithStatus,
} from "@/lib/studentAchievements";
import { studentLessonsOrFilter } from "@/lib/studentLessons";
import { fetchHomeworkDone } from "@/lib/homeworkDone";
import {
  weeklyStreak,
  weekGoal,
  scheduledLeftThisWeek,
  streakState,
  type StreakState,
  type WeeklyStreak,
  type WeekGoal,
} from "@/lib/studentGamification";

export interface StudentReward {
  id: string;
  emoji: string;
  theme: string;
  earned_at: string;
  lesson_id: string | null;
}

// Type-cast helper since student_rewards is not yet in generated types
const db = supabase as any;

interface LessonRow { id: string; starts_at: string; status: string }

/**
 * ЄДИНИЙ хук гейміфікації учня (був `useStudentRewards`, перейменовано 27.09).
 *
 * Чому перейменовано, а не додано другий: до 27.09 нагороди, ачівки, рівень і
 * «цей тиждень» жили в трьох поверхнях, і кожна рахувала своє. Тепер джерело
 * одне — і дашборд, і сторінка досягнень читають ці самі числа, тож розʼїхатись
 * їм нічим. Назва «rewards» брехала: емодзі-нагороди — лише одна п'ята того,
 * що тут рахується.
 */
export function useStudentGamification() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rewards, setRewards] = useState<StudentReward[]>([]);
  const [achievements, setAchievements] = useState<StudentAchievementWithStatus[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [homeworkLessonIds, setHomeworkLessonIds] = useState<Set<string>>(new Set());
  const [homeworkDoneIds, setHomeworkDoneIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  /* Аудит 03.09: помилки читання ігнорувались, і збій виглядав як «0
     досягнень, нічого не заробив». Гейміфікація — стовп продукту; впевнена
     нула демотивує сильніше за порожній екран. */
  const [loadError, setLoadError] = useState(false);
  const initialized = useRef(false);

  const load = async () => {
    if (!user) return;
    const { data, error } = await db
      .from("student_rewards")
      .select("id, emoji, theme, earned_at, lesson_id")
      .eq("student_id", user.id)
      .order("earned_at", { ascending: false })
      .limit(50);
    if (error) { setLoadError(true); setLoading(false); return; }
    setLoadError(false);
    setRewards((data as StudentReward[] | null) ?? []);
    setLoading(false);
  };

  // Achievements catalog (earned/unearned + progress) computed client-side from
  // the student's own lessons + assigned homework. No backend/table required.
  const loadAchievements = async () => {
    if (!user) return;
    const [{ data: lessonRows, error: lessonsErr }, { data: hw }] = await Promise.all([
      // Include GROUP lessons (student linked via lesson_participants; lessons.student_id
      // is NULL) so achievements/streaks count them too.
      supabase.from("lessons").select("id, starts_at, status").or(await studentLessonsOrFilter(user.id)),
      // lesson_details_student is the student-safe view (self-filters by student_id =
      // auth.uid()); the base lesson_details table is tutor/manager-only now.
      (supabase as any)
        .from("lesson_details_student")
        .select("lesson_id, homework")
        .not("homework", "is", null),
    ]);
    if (lessonsErr) { setLoadError(true); return; }
    const all = ((lessonRows ?? []) as LessonRow[]);
    setLessons(all);
    const completed = all.filter((l) => l.status === "completed");
    const completedDates = completed.map((l) => new Date(l.starts_at));
    const hwIds = new Set<string>(
      ((hw ?? []) as Array<{ lesson_id: string | null; homework: string | null }>)
        .filter((d) => d.lesson_id && d.homework && d.homework.trim())
        .map((d) => d.lesson_id as string),
    );
    setHomeworkLessonIds(hwIds);
    setAchievements(
      computeStudentAchievements({
        completedLessons: completed.length,
        lessonsWithHomework: hwIds.size,
        earlyBirdLessons: completedDates.filter((d) => d.getHours() < 9).length,
        maxConsecutiveWeeks: maxConsecutiveWeeks(completedDates),
      }),
    );
    /* Позначки «домашку виконано» — тим самим каноном, що й сторінка домашки
       (`fetchHomeworkDone`): сервер плюс локальний кеш як фолбек. Другого
       читання `homework_done` у застосунку бути не повинно. */
    try { setHomeworkDoneIds(await fetchHomeworkDone(user.id)); } catch { /* ціль тижня просто без домашки */ }
  };

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`student_rewards:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "student_rewards", filter: `student_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as StudentReward;
          setRewards((prev) => [row, ...prev]);
          if (!initialized.current) return;
          toast.success(t("rewardCollection.newReward"), {
            description: t("rewardCollection.newRewardDesc", { emoji: row.emoji }),
            className: "text-2xl",
          });
        }
      )
      .subscribe();

    // Single load — mark initialized after it completes
    load().then(() => { initialized.current = true; });
    loadAchievements();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const earnedAchievements = achievements.filter((a) => a.earned).length;

  /* Серія й ціль тижня — з уже прочитаних уроків, без жодного нового запиту.
     Рахує чистий модуль, тому те саме число покажуть усі поверхні. */
  const streak: WeeklyStreak = useMemo(
    () => weeklyStreak(lessons.filter((l) => l.status === "completed").map((l) => l.starts_at)),
    [lessons],
  );
  const goal: WeekGoal = useMemo(
    () => weekGoal({ lessons, homeworkLessonIds, homeworkDoneIds }),
    [lessons, homeworkLessonIds, homeworkDoneIds],
  );
  const state: StreakState = useMemo(
    () => streakState({
      current: streak.current,
      thisWeekCount: streak.thisWeekCount,
      scheduledLeftThisWeek: scheduledLeftThisWeek(lessons),
    }),
    [streak, lessons],
  );

  const reload = () => { setLoading(true); void load(); void loadAchievements(); };

  return {
    rewards,
    achievements,
    earnedAchievements,
    totalAchievements: achievements.length,
    streak,
    streakState: state,
    goal,
    loading,
    loadError,
    reload,
  };
}
