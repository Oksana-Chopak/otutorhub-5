import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import {
  computeStudentAchievements,
  maxConsecutiveWeeks,
  type StudentAchievementWithStatus,
} from "@/lib/studentAchievements";

export interface StudentReward {
  id: string;
  emoji: string;
  theme: string;
  earned_at: string;
  lesson_id: string | null;
}

// Type-cast helper since student_rewards is not yet in generated types
const db = supabase as any;

export function useStudentRewards() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rewards, setRewards] = useState<StudentReward[]>([]);
  const [achievements, setAchievements] = useState<StudentAchievementWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const load = async () => {
    if (!user) return;
    const { data } = await db
      .from("student_rewards")
      .select("id, emoji, theme, earned_at, lesson_id")
      .eq("student_id", user.id)
      .order("earned_at", { ascending: false })
      .limit(50);
    setRewards((data as StudentReward[] | null) ?? []);
    setLoading(false);
  };

  // Achievements catalog (earned/unearned + progress) computed client-side from
  // the student's own lessons + assigned homework. No backend/table required.
  const loadAchievements = async () => {
    if (!user) return;
    const [{ data: lessons }, { data: hw }] = await Promise.all([
      supabase.from("lessons").select("starts_at, status").eq("student_id", user.id),
      supabase
        .from("lesson_details")
        .select("homework, lessons!inner(student_id)")
        .eq("lessons.student_id", user.id)
        .not("homework", "is", null),
    ]);
    const completed = ((lessons ?? []) as { starts_at: string; status: string }[]).filter(
      (l) => l.status === "completed",
    );
    const completedDates = completed.map((l) => new Date(l.starts_at));
    const lessonsWithHomework = ((hw ?? []) as { homework: string | null }[]).filter(
      (d) => d.homework && d.homework.trim(),
    ).length;
    setAchievements(
      computeStudentAchievements({
        completedLessons: completed.length,
        lessonsWithHomework,
        earlyBirdLessons: completedDates.filter((d) => d.getHours() < 9).length,
        maxConsecutiveWeeks: maxConsecutiveWeeks(completedDates),
      }),
    );
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
            duration: 6000,
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

  return { rewards, achievements, earnedAchievements, loading };
}
