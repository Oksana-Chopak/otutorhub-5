import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/hooks/useConfirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LessonWorkspace } from "@/components/LessonWorkspace";
import { GroupLessonParticipants } from "@/components/GroupLessonParticipants";
import { notifyGroupLessonCancelled } from "@/lib/groupLessons";
import { Loader2, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";

interface LessonRowFull {
  id: string;
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  student_price: number;
  student_payment_status: "paid" | "unpaid";
  meeting_url: string | null;
  homework: string | null;
  summary: string | null;
  student_notes: string | null;
  source: "hub" | "independent";
  group_id: string | null;
}

interface Props {
  lessonId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}

/**
 * Reusable single-lesson modal. Loads fresh lesson row by id so the modal
 * always shows current data even when the parent list is stale.
 */
export function LessonDetailsDialog({ lessonId, open, onOpenChange, onUpdated }: Props) {
  const { t, i18n } = useTranslation();
  const { user, roles } = useAuth();
  const [row, setRow] = useState<LessonRowFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Guard parity with the schedule card: only a manager, or the owning tutor on a
  // pending/scheduled lesson, may delete. (RLS also rejects, but don't offer a
  // button that will fail on completed/cancelled lessons.)
  const canDelete =
    !!row &&
    (roles.includes("manager") ||
      (roles.includes("tutor") &&
        row.tutor_id === user?.id &&
        (row.status === "pending" || row.status === "scheduled")));

  const handleDelete = async () => {
    if (!row) return;
    if (!(await confirmDialog({ description: t("schedulePageExtra.deleteConfirmDesc"), destructive: true, confirmText: t("common.delete") }))) return;
    setDeleting(true);
    // Group lesson: notify participants BEFORE delete (their rows cascade away).
    if (row.group_id) await notifyGroupLessonCancelled(row.id, row.subject);
    const { error } = await supabase.from("lessons").delete().eq("id", row.id);
    setDeleting(false);
    if (error) {
      toast.error(t("schedule.deleteFailed"));
      return;
    }
    onUpdated?.();
    onOpenChange(false);
  };

  const load = async (id: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("lessons_visible")
      .select(
        "id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, student_payment_status, meeting_url, homework, summary, student_notes, source, group_id"
      )
      .eq("id", id)
      .maybeSingle();
    setRow((data as LessonRowFull | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (open && lessonId) load(lessonId);
    if (!open) setRow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lessonId]);

  const locale = i18n.language === "sv" ? "sv-SE" : i18n.language === "en" ? "en-GB" : "uk-UA";
  const sub = row
    ? new Date(row.starts_at).toLocaleString(locale, {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-3xl p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px 12px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row ? row.subject : t("lessonDetails.fallbackTitle")}
            </div>
            {sub && <div style={{ fontSize: 15, color: "var(--sub,#6b7088)", marginTop: 1 }}>{sub}</div>}
          </div>
          <button onClick={() => onOpenChange(false)} aria-label="✕"
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "#F5F4F0", color: "var(--sub,#6b7088)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 20px 20px" }}>
        {loading || !row ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : row.group_id ? (
          /* Group lesson: per-participant roster + payment marking (student_id is
             NULL on the lesson; each student's price/payment is on lesson_participants). */
          <GroupLessonParticipants
            lessonId={row.id}
            canEdit={roles.includes("manager") || (roles.includes("tutor") && row.tutor_id === user?.id)}
            onUpdated={() => onUpdated?.()}
          />
        ) : (
          <LessonWorkspace
            lessonId={row.id}
            tutorId={row.tutor_id}
            studentId={row.student_id}
            meetingUrl={row.meeting_url}
            homework={row.homework}
            summary={row.summary}
            studentNotes={row.student_notes}
            source={row.source}
            studentPrice={row.student_price}
            studentPaymentStatus={row.student_payment_status}
            lessonStatus={row.status}
            onUpdated={() => {
              load(row.id);
              onUpdated?.();
            }}
          />
        )}
        </div>
        {/* Sticky edit footer: delete + done (fields auto-save inline) */}
        {!loading && row && (
          <div style={{ flexShrink: 0, padding: "14px 20px 22px", borderTop: "1px solid #f0f1f5", background: "#fff", display: "flex", gap: 11 }}>
            {canDelete && (
              <button
                type="button"
                aria-label={t("lessonDetails.deleteBtn")}
                onClick={handleDelete}
                disabled={deleting}
                style={{ width: 52, height: 52, borderRadius: 14, flexShrink: 0, border: "none", cursor: "pointer", background: "rgba(255,122,89,.12)", color: "#e0552f", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                {deleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 size={20} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{ flex: 1, height: 52, borderRadius: 14, border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 16, cursor: "pointer", boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}
            >
              {t("lessonDetails.doneBtn")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
