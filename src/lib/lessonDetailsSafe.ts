// Tutor/manager writes to lesson_details must go through the SECURITY DEFINER
// RPC `update_lesson_details_safe`. The DB has NO direct tutor UPDATE policy on
// lesson_details (see migration 20260628000000) — direct .update/.upsert from a
// tutor key would fail. The RPC enforces a strict safe-column whitelist:
//   homework, summary, student_notes,
//   student_price, student_payment_status, student_paid_at,
//   fireflies_meeting_id, fireflies_requested_at, fireflies_status
// Sensitive columns (tutor_payout*, fireflies_summary/transcript/recording_url/
// audio_url/action_items/completed_at) can only be written by the manager
// policy or the Fireflies webhook running as service_role.
import { supabase } from "@/integrations/supabase/client";
import { enqueue, isOffline } from "@/lib/offlineQueue";

export type LessonDetailsPatch = {
  homework?: string | null;
  summary?: string | null;
  student_notes?: string | null;
  student_price?: number | string | null;
  student_payment_status?: "paid" | "unpaid" | string | null;
  student_paid_at?: string | null;
  /** Marks a cancelled lesson's student_price as a withheld cancellation fee —
   * same write gate as student_price (hub-scoped manager / independent owner). */
  is_cancellation_fee?: boolean;
  // Manager-only: the RPC applies these ONLY when the caller has the manager role
  // (the columns are GRANT-locked otherwise). Safe to pass as a tutor — ignored.
  tutor_payout?: number | string | null;
  tutor_payout_status?: "paid" | "unpaid" | string | null;
  fireflies_meeting_id?: string | null;
  fireflies_requested_at?: string | null;
  fireflies_status?: string | null;
};

export async function updateLessonDetailsSafe(
  lessonId: string,
  patch: LessonDetailsPatch,
): Promise<{ error: { message: string } | null }> {
  // D (офлайн): без мережі запис їде в чергу і реплеїться при відновленні.
  // Значення в патчі абсолютні (paid/unpaid, текст) — повтор безпечний.
  // ВСІ виклики цієї функції стають офлайн-стійкими в одній точці.
  if (isOffline()) {
    enqueue({ kind: "lesson_details", lessonId, patch: patch as Record<string, unknown> });
    return { error: null };
  }
  const { error } = await supabase.rpc("update_lesson_details_safe", {
    _lesson_id: lessonId,
    _patch: patch,
  });
  return { error: error ? { message: error.message } : null };
}

/** B4: як Bulk, але повертає ПОІМЕННО, які записи не вдалися — щоб масові дії
 * відкочували лише невдалі рядки, а не всі 50 разом із 40 успішними. */
export async function updateLessonDetailsSafeEach(
  lessonIds: string[],
  patch: LessonDetailsPatch,
): Promise<{ failedIds: string[]; error: { message: string } | null }> {
  if (lessonIds.length === 0) return { failedIds: [], error: null };
  const results = await Promise.all(lessonIds.map((id) => updateLessonDetailsSafe(id, patch)));
  const failedIds = lessonIds.filter((_, i) => results[i].error);
  return { failedIds, error: results.find((r) => r.error)?.error ?? null };
}

/** Same RPC applied to many lesson_ids — replaces `.in("lesson_id", ids).update(patch)`. */
export async function updateLessonDetailsSafeBulk(
  lessonIds: string[],
  patch: LessonDetailsPatch,
): Promise<{ error: { message: string } | null }> {
  if (lessonIds.length === 0) return { error: null };
  const results = await Promise.all(lessonIds.map((id) => updateLessonDetailsSafe(id, patch)));
  const firstErr = results.find((r) => r.error)?.error ?? null;
  return { error: firstErr };
}
