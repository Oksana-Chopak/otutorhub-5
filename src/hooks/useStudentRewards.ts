import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";

export interface StudentReward {
  id: string;
  emoji: string;
  theme: string;
  earned_at: string;
  lesson_id: string | null;
}

// Type-cast helper since student_rewards is not yet in generated types
const db = supabase as unknown as typeof supabase & {
  from(table: "student_rewards"): ReturnType<typeof supabase.from>;
};

export function useStudentRewards() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rewards, setRewards] = useState<StudentReward[]>([]);
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

  useEffect(() => {
    if (!user) return;
    load();

    const channel = supabase
      .channel(`student_rewards:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "student_rewards", filter: `student_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as StudentReward;
          setRewards((prev) => [row, ...prev]);

          // Don't toast on first load
          if (!initialized.current) return;

          toast.success(t("rewardCollection.newReward"), {
            description: t("rewardCollection.newRewardDesc", { emoji: row.emoji }),
            duration: 6000,
            className: "text-2xl",
          });
        }
      )
      .subscribe();

    // Mark as initialized after first load
    load().then(() => { initialized.current = true; });

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { rewards, loading };
}
