import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface TutorLevel {
  key: "novice" | "practitioner" | "master" | "expert" | "pro_tutor";
  name: string;
  emoji: string;
  completed_lessons: number;
  referrals_count: number;
  is_pro: boolean;
  next_threshold: number | null;
}

export interface MonthlySummary {
  lessons_count: number;
  completed_count: number;
  paid_count: number;
  on_time_payment_pct: number | null;
  top_percentile: number | null;
  total_active_tutors: number;
  year: number;
  month: number;
}

export interface TutorStreak {
  current_streak: number;
  longest_streak: number;
  last_lesson_date: string | null;
}

export interface TutorBadge {
  badge_key: string;
  awarded_at: string;
  metadata: any;
}

export function useTutorGamification() {
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");
  const [level, setLevel] = useState<TutorLevel | null>(null);
  const [streak, setStreak] = useState<TutorStreak | null>(null);
  const [badges, setBadges] = useState<TutorBadge[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !isTutor) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [levelRes, streakRes, badgesRes] = await Promise.all([
      supabase.rpc("get_tutor_level", { _tutor_id: user.id }),
      supabase.from("tutor_streaks").select("*").eq("tutor_id", user.id).maybeSingle(),
      supabase.from("tutor_badges").select("*").eq("tutor_id", user.id).order("awarded_at", { ascending: false }),
    ]);
    if (levelRes.data) setLevel(levelRes.data as unknown as TutorLevel);
    if (streakRes.data) setStreak(streakRes.data as TutorStreak);
    if (badgesRes.data) setBadges(badgesRes.data as TutorBadge[]);
    setLoading(false);
  }, [user?.id, isTutor]);

  useEffect(() => {
    load();
  }, [load]);

  return { level, streak, badges, loading, refresh: load };
}

export function useMonthlySummary(year?: number, month?: number) {
  const { user, roles } = useAuth();
  const isTutor = roles.includes("tutor");
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Default: previous month
  const now = new Date();
  const targetYear = year ?? (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const targetMonth = month ?? (now.getMonth() === 0 ? 12 : now.getMonth());

  useEffect(() => {
    if (!user || !isTutor) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .rpc("get_tutor_monthly_summary", {
        _tutor_id: user.id,
        _year: targetYear,
        _month: targetMonth,
      })
      .then(({ data }) => {
        if (data) setSummary(data as unknown as MonthlySummary);
        setLoading(false);
      });
  }, [user?.id, isTutor, targetYear, targetMonth]);

  return { summary, loading, year: targetYear, month: targetMonth };
}
