import { supabase } from "@/integrations/supabase/client";
import { insertNotification } from "@/lib/notifications";
import i18nInstance from "@/i18n";

const t = i18nInstance.t.bind(i18nInstance);

interface CreateGroupLessonOpts {
  tutorId: string;
  groupId: string;
  subject: string;
  startsAt: string; // ISO
  durationMinutes: number;
  source: "hub" | "independent";
  createdBy: string;
}

/**
 * Create ONE group lesson + its per-participant billing rows, and notify every
 * enrolled student. Shared by every scheduler (independent QuickLessonDialog,
 * manager/hub Schedule). A group lesson has `lessons.student_id = NULL`; the
 * students live in `lesson_participants`, and each participant's price is a SNAPSHOT
 * of their `group_enrollments.price_per_lesson` at creation time (so later rate
 * changes don't rewrite past lessons — same model as lesson_details for individual).
 */
export async function createGroupLesson(
  opts: CreateGroupLessonOpts,
): Promise<{ lessonId: string | null; error: string | null }> {
  // Active enrollments + each student's configured group price — via the MASKED
  // view (a hub tutor reads price as NULL; the BEFORE INSERT trigger
  // fill_group_participant_price then snapshots the real price server-side).
  const { data: ens, error: enErr } = await (supabase.from("group_enrollments_visible" as any) as any)
    .select("student_id, price_per_lesson, currency, status")
    .eq("group_id", opts.groupId)
    .eq("status", "active");
  if (enErr) return { lessonId: null, error: enErr.message };
  const participants = (ens ?? []).filter((e) => e.student_id);

  const lessonType: "pair" | "group" = participants.length === 2 ? "pair" : "group";
  const { data: created, error } = await supabase
    .from("lessons")
    .insert({
      tutor_id: opts.tutorId,
      student_id: null,
      group_id: opts.groupId,
      lesson_type: lessonType,
      subject: opts.subject,
      starts_at: opts.startsAt,
      duration_minutes: opts.durationMinutes,
      status: "scheduled",
      created_by: opts.createdBy,
      source: opts.source,
    })
    .select("id")
    .single();
  if (error || !created) return { lessonId: null, error: error?.message ?? "create failed" };

  if (participants.length) {
    // Per-participant billing snapshot.
    const { error: pErr } = await supabase.from("lesson_participants").insert(
      participants.map((p) => ({
        lesson_id: created.id,
        student_id: p.student_id,
        student_price: p.price_per_lesson,
        currency: p.currency ?? "UAH",
        student_payment_status: "unpaid",
      })),
    );
    if (pErr) console.error("[groupLessons] participants insert failed:", pErr);

    // Notify each enrolled student (unique type per lesson → no 24h dedup collapse).
    participants.forEach((p) => {
      void insertNotification({
        userId: p.student_id as string,
        type: `group_lesson_${created.id}`,
        title: t("groupLessons.notifNewTitle", { subject: opts.subject }),
        link: "/student/schedule",
      });
    });
  }

  return { lessonId: created.id, error: null };
}

/**
 * Notify every participant of a group lesson that it was cancelled/deleted. Safe to
 * call for ANY lesson id — individual lessons have no lesson_participants rows, so it's
 * a no-op there. Call BEFORE deleting the lesson (the participant rows cascade away on
 * delete), or any time for a status→cancelled change. Best-effort; never throws.
 */
export async function notifyGroupLessonCancelled(lessonId: string, subject: string): Promise<void> {
  const { data: parts } = await supabase
    .from("lesson_participants")
    .select("student_id")
    .eq("lesson_id", lessonId);
  ((parts ?? []) as { student_id: string }[]).forEach((p) => {
    if (!p.student_id) return;
    void insertNotification({
      userId: p.student_id,
      type: `group_lesson_cancelled_${lessonId}`,
      title: t("groupLessons.notifCancelledTitle", { subject }),
      link: "/student/schedule",
    });
  });
}
