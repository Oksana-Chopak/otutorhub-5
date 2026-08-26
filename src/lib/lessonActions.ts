import { supabase } from "@/integrations/supabase/client";

/** ЄДИНИЙ писар статусів уроку (розтяжка №10): одна точка для всіх ролей. */
export type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";

export async function setLessonStatus(lessonId: string, status: LessonStatus) {
  return supabase.from("lessons").update({ status }).eq("id", lessonId);
}

export async function completeLessons(ids: string[]) {
  if (ids.length === 0) return { error: null } as { error: null };
  return supabase.from("lessons").update({ status: "completed" }).in("id", ids);
}

/** Перенос уроку (approve запиту): нова дата + повернення у scheduled — одним писарем. */
export async function rescheduleLesson(lessonId: string, startsAtIso: string) {
  return supabase.from("lessons").update({ starts_at: startsAtIso, status: "scheduled" }).eq("id", lessonId);
}
