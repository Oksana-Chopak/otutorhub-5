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
/**
 * 18.09: раніше помилка цього запиту ковталась, і фільтр ТИХО звужувався до
 * самих індивідуальних уроків — учень, у якого лише групові, бачив ПОРОЖНІЙ
 * розклад і думав, що уроки скасували. Екран при цьому виглядав здоровим, бо
 * основний запит проходив.
 *
 * Кидати виняток не можна: жоден із чотирьох викликів не загорнутий у
 * try/catch, тож сторінка зависла б на скелетоні назавжди — це гірше за
 * неповний список. Тому фолбек лишається, але тепер він ПОЗНАЧЕНИЙ: `partial`
 * каже викликачу, що список неповний, і сторінка може сказати це словами.
 */
export async function studentLessonsFilter(
  studentId: string,
): Promise<{ filter: string; partial: boolean }> {
  const { data, error } = await supabase
    .from("lesson_participants")
    .select("lesson_id")
    .eq("student_id", studentId);
  if (error) console.error("[studentLessons] group participations read failed", error.message);
  const ids = (data ?? []).map((p: { lesson_id: string }) => p.lesson_id).filter(Boolean);
  return {
    filter: ids.length
      ? `student_id.eq.${studentId},id.in.(${ids.join(",")})`
      : `student_id.eq.${studentId}`,
    partial: !!error,
  };
}

/** Сумісна обгортка для місць, де неповнота не має окремого стану. */
export async function studentLessonsOrFilter(studentId: string): Promise<string> {
  return (await studentLessonsFilter(studentId)).filter;
}
