import { supabase } from "@/integrations/supabase/client";

/**
 * Build a PostgREST `.or(...)` filter that matches a student's lessons INCLUDING
 * group lessons. Individual lessons have `lessons.student_id = me`; group lessons
 * have `student_id = NULL` and link the student via `lesson_participants`, so they'd
 * be invisible to a plain `.eq("student_id", me)`. RLS ("Student views group lessons")
 * already allows the student to read group lessons they're enrolled in.
 *
 * Usage: `query.or(await studentLessonsOrFilter(user.id))`
 */
export async function studentLessonsOrFilter(studentId: string): Promise<string> {
  const { data } = await supabase
    .from("lesson_participants")
    .select("lesson_id")
    .eq("student_id", studentId);
  const ids = (data ?? []).map((p: { lesson_id: string }) => p.lesson_id).filter(Boolean);
  return ids.length
    ? `student_id.eq.${studentId},id.in.(${ids.join(",")})`
    : `student_id.eq.${studentId}`;
}
