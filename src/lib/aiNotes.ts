import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget: if the current tutor has "Авто-конспект" enabled and this lesson
 * isn't being recorded yet, ask the Fireflies bot to join the call. Called when the
 * tutor clicks the meeting/join link, so recording starts exactly when the lesson does.
 *
 * Silent by design — never blocks navigation, never throws. Returns true if a start
 * request was actually sent (so the caller can show a toast).
 */
export async function maybeAutoStartFireflies(
  lessonId: string,
  meetingUrl: string | null | undefined,
): Promise<boolean> {
  try {
    if (!meetingUrl || !meetingUrl.trim()) return false;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return false;

    // Tutor opted in?
    const { data: ws } = await supabase
      .from("tutor_workspace_settings")
      .select("ai_notes_auto")
      .eq("tutor_id", uid)
      .maybeSingle();
    if (!ws?.ai_notes_auto) return false;

    // Already requested / recorded for this lesson?
    const { data: ld } = await supabase
      .from("lesson_details")
      .select("fireflies_status")
      .eq("lesson_id", lessonId)
      .maybeSingle();
    const status = (ld as unknown as Record<string, unknown> | null)?.fireflies_status as string | undefined;
    if (status) return false; // requested / recording / done — don't double-start

    const { error } = await supabase.functions.invoke("fireflies-start-recording", {
      body: { lessonId, meetingUrl },
    });
    return !error;
  } catch {
    return false;
  }
}
