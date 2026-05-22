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
