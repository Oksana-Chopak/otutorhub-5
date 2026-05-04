import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Determines onboarding state for a student:
 * - hasQuiz: at least one student_intake_quiz row exists
 * - hasTutor: at least one student_rates row exists
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
    const [quizRes, ratesRes] = await Promise.all([
      supabase
        .from("student_intake_quiz")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user.id),
      supabase
        .from("student_rates")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user.id),
    ]);
    setHasQuiz((quizRes.count ?? 0) > 0);
    setHasTutor((ratesRes.count ?? 0) > 0);
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
