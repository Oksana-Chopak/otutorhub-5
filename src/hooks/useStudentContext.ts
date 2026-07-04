import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Determines onboarding state for a student:
 * - hasQuiz: at least one student_intake_quiz row exists
 * - hasTutor: at least one student_rates row OR active group enrollment exists
 */
export function useStudentContext() {
  const { user, roles } = useAuth();
  const isStudent = roles.includes("student") && !roles.includes("manager") && !roles.includes("tutor");
  const [loading, setLoading] = useState(true);
  const [hasQuiz, setHasQuiz] = useState(false);
  const [hasTutor, setHasTutor] = useState(false);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    const [quizRes, ratesRes, groupRes] = await Promise.all([
      supabase
        .from("student_intake_quiz")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user.id),
      supabase
        .from("student_rates")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user.id),
      // A manager can put a student STRAIGHT into a group (no student_rates row) —
      // counting only rates treated group-only students as tutor-less and forced
      // them into the find-a-tutor quiz (phantom tutor_referral_requests).
      supabase
        .from("group_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user.id)
        .eq("status", "active"),
    ]);
    setHasQuiz((quizRes.count ?? 0) > 0);
    setHasTutor((ratesRes.count ?? 0) > 0 || (groupRes.count ?? 0) > 0);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { loading, hasQuiz, hasTutor, isStudent, refresh };
}
