import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafe } from "@/lib/lessonDetailsSafe";

/**
 * B-D3: ліб-писар «Запланувати наступні одним тапом» — дзеркалить канон
 * QuickLessonDialog: той самий payload (created_by, source, duration, subject),
 * hub-ряди покладаються на серверний autofill-тригер (маржа свята), independent
 * отримують student_price через updateLessonDetailsSafe. +7 днів, та сама година.
 */
export type NextWeekRow = {
  id: string;
  student_id: string;
  tutor_id: string;
  subject: string;
  starts_at: string;
  duration_minutes?: number | null;
  source?: string | null;
  price: number;
};

export async function createNextWeekLessons(
  chosen: NextWeekRow[],
  createdBy: string,
): Promise<{ count: number; error: string | null }> {
  if (!chosen.length) return { count: 0, error: null };
  const payloads = chosen.map((r) => ({
    tutor_id: r.tutor_id,
    created_by: createdBy,
    student_id: r.student_id,
    subject: r.subject,
    duration_minutes: r.duration_minutes ?? 60,
    status: "scheduled" as const,
    source: (r.source ?? "independent") as string,
    starts_at: (() => { const d = new Date(r.starts_at); d.setDate(d.getDate() + 7); return d.toISOString(); })(), // DST-безпечно
    meeting_url: null as string | null,
  }));
  const { data: createdRows, error } = await supabase.from("lessons").insert(payloads).select("id");
  if (error) return { count: 0, error: error.message };
  await Promise.all(
    (createdRows ?? []).map((c: any, i: number) =>
      chosen[i]?.source === "independent"
        ? updateLessonDetailsSafe(c.id, { student_price: chosen[i].price || 0 })
        : Promise.resolve(),
    ),
  );
  return { count: payloads.length, error: null };
}
