import { supabase } from "@/integrations/supabase/client";

/**
 * B18: ЄДИНИЙ розумний дефолт часу «нового уроку» — найімовірніший намір:
 * той самий час цієї пари наступного тижня (останній урок + 7 днів).
 * null → хай поверхня лишає свій фолбек (наступна повна година).
 */
export async function pairNextDefault(tutorId: string, studentId: string): Promise<Date | null> {
  const { data } = await supabase
    .from("lessons")
    .select("starts_at")
    .eq("tutor_id", tutorId)
    .eq("student_id", studentId)
    .order("starts_at", { ascending: false })
    .limit(1);
  const last = (data as any[])?.[0]?.starts_at as string | undefined;
  if (!last) return null;
  const d = new Date(last);
  // P3: остання пара могла бути давно — котимо тижнями вперед, доки не в майбутньому.
  do { d.setDate(d.getDate() + 7); } while (d.getTime() <= Date.now());
  return d;
}
