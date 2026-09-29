// Shared helper to trigger Google Calendar sync for a lesson.
// Best-effort: never throws to the caller.

import { supabase } from "@/integrations/supabase/client";

export async function syncLessonToGoogleCalendar(
  lessonId: string,
  action: "upsert" | "delete" = "upsert",
) {
  try {
    const { error } = await supabase.functions.invoke("sync-google-calendar", {
      body: { lesson_id: lessonId, action },
    });
    if (error) {
      // Sync is best-effort; do not block lesson UX.
      console.warn("[google-calendar] sync returned error", error);
    }
  } catch (e) {
    console.warn("[google-calendar] sync failed", e);
  }
}

/**
 * 29.09, «Перенести все, що є»: уроки, створені імпортом (список, таблиця,
 * файл), — у Google Календар репетитора, якщо він підключений. Best-effort і
 * лише майбутні уроки без події в Google; імпорт ІЗ календаря сюди не заходить
 * (інакше в календарі зʼявились би дублікати того, що там уже є).
 * Повертає, скільки уроків надіслано на синхронізацію.
 */
export async function backSyncImportedLessons(tutorId: string, studentIds: string[], max = 100): Promise<number> {
  if (!studentIds.length) return 0;
  try {
    const { data: tok } = await supabase
      .from("google_calendar_tokens")
      .select("user_id")
      .eq("user_id", tutorId)
      .maybeSingle();
    if (!tok) return 0;
    const { data: lessons } = await supabase
      .from("lessons")
      .select("id, google_event_id, starts_at")
      .eq("tutor_id", tutorId)
      .in("student_id", studentIds)
      .is("google_event_id", null)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(max);
    let sent = 0;
    for (const l of lessons ?? []) {
      await syncLessonToGoogleCalendar(l.id, "upsert");
      sent += 1;
    }
    return sent;
  } catch (e) {
    console.warn("[google-calendar] back-sync after import failed", e);
    return 0;
  }
}
