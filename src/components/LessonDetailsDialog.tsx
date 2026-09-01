import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/hooks/useConfirm";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LessonWorkspace } from "@/components/LessonWorkspace";
import { GroupLessonParticipants } from "@/components/GroupLessonParticipants";
import { notifyGroupLessonCancelled } from "@/lib/groupLessons";
import { Loader2, X, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { DateTimeField } from "@/components/DateTimeField";
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
  const [studentName, setStudentName] = useState("");
  const [dtEdit, setDtEdit] = useState(false);
  const [dtVal, setDtVal] = useState("");
  const [durVal, setDurVal] = useState(60);
  const [dtSaving, setDtSaving] = useState(false);

  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  const openDtEdit = () => {
    if (!row) return;
    setDtVal(toLocalInput(row.starts_at));
    setDurVal(row.duration_minutes ?? 60);
    setDtEdit(true);
  };
  const saveDt = async () => {
    if (!row || !dtVal) return;
    setDtSaving(true);
    try {
      const { error } = await supabase
        .from("lessons")
        .update({ starts_at: new Date(dtVal).toISOString(), duration_minutes: durVal })
        .eq("id", row.id);
      setDtSaving(false);
      if (error) { toast.error(t("lessonDetails.dtSaveFailed")); return; }
      setDtEdit(false);
      toast.success(t("lessonDetails.dtSaved"));
      load(row.id);
      onUpdated?.();
    } finally {
      setDtSaving(false);
    }
  };
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false); // B9
  const [deleting, setDeleting] = useState(false);

  // Guard parity with the schedule card: only a manager, or the owning tutor on a
  // pending/scheduled lesson, may delete. (RLS also rejects, but don't offer a
  // button that will fail on completed/cancelled lessons.)
  // Перенесення дозволене менеджеру та власнику-репетитору незалежно від статусу
  // (стара форма дозволяла так само; canDelete лишається суворішим).
  const canReschedule =
    !!row && (roles.includes("manager") || (roles.includes("tutor") && row.tutor_id === user?.id));

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
    try {
      if (row.group_id) await notifyGroupLessonCancelled(row.id, row.subject);
      const { error } = await supabase.from("lessons").delete().eq("id", row.id);
      setDeleting(false);
      if (error) {
        toast.error(t("schedule.deleteFailed"));
        return;
      }
      onUpdated?.();
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  };

  const load = async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lessons_visible")
      .select(
        "id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, student_payment_status, meeting_url, homework, summary, student_notes, source, group_id"
      )
      .eq("id", id)
      .maybeSingle();
    // B9: раніше error не читався — і збій мережі, і видалений урок давали
    // ВІЧНИЙ спінер без тексту. Тепер три стани: завантаження / помилка / немає.
    setLoadFailed(!!error);
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

  useEffect(() => {
    if (!row?.student_id) { setStudentName(""); return; }
    supabase.from("profiles").select("first_name, last_name").eq("id", row.student_id).maybeSingle()
      .then(({ data }) => setStudentName([data?.first_name, data?.last_name].filter(Boolean).join(" ")));
  }, [row?.student_id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card w-full max-w-3xl p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        {/* C3: VoiceOver казав просто «діалог» — тепер діалог названо */}
        <DialogTitle className="sr-only">{row ? row.subject : t("lessonDetails.fallbackTitle")}</DialogTitle>
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div className="bg-foreground/15" style={{ width: 38, height: 4, borderRadius: 999 }} />
        </div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px 12px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div className="text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row ? row.subject : t("lessonDetails.fallbackTitle")}
            </div>
            {(studentName || sub) && (
              <div className="text-muted-foreground flex items-center gap-1.5" style={{ fontSize: 15, marginTop: 1, minWidth: 0 }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[studentName, sub].filter(Boolean).join(" · ")}</span>
                {canReschedule && !dtEdit && (
                  <button type="button" aria-label={t("lessonCard.edit")} onClick={openDtEdit}
                    className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5">
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            )}
            {dtEdit && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <DateTimeField value={dtVal} onChange={setDtVal}
                  durationMin={durVal} onDurationChange={setDurVal} className="min-w-0 flex-1" />
                <button type="button" onClick={saveDt} disabled={dtSaving}
                  className="tap-44 bg-primary text-primary-foreground h-10 rounded-[10px] px-3 text-[14px] font-bold disabled:opacity-60">
                  {dtSaving ? "…" : "✓"}
                </button>
                <button type="button" onClick={() => setDtEdit(false)}
                  className="text-muted-foreground h-10 rounded-[10px] px-2 text-[14px]">✕</button>
              </div>
            )}
          </div>
          <button onClick={() => onOpenChange(false)} aria-label="✕"
            className="bg-secondary text-muted-foreground" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "4px 20px 20px" }}>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !row ? (
          /* B9: урок видалили або читання впало — кажемо, що сталося, і даємо дію */
          <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
            <p className="text-[15px] text-muted-foreground max-w-sm">
              {t(loadFailed ? "lessonDetails.loadFailed" : "lessonDetails.notFound")}
            </p>
            <button
              type="button"
              onClick={() => (loadFailed && lessonId ? load(lessonId) : onOpenChange(false))}
              className="h-11 rounded-[12px] px-5 text-[14px] font-semibold"
              style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", border: "none", cursor: "pointer" }}
            >
              {t(loadFailed ? "lessonDetails.retryBtn" : "lessonDetails.closeBtn")}
            </button>
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
            onClose={() => onOpenChange(false)}
            lessonId={row.id}
            tutorId={row.tutor_id}
            studentId={row.student_id}
            meetingUrl={row.meeting_url}
            homework={row.homework}
            summary={row.summary}
            studentNotes={row.student_notes}
            source={row.source}
            studentPrice={row.student_price}
            currency={(row as any)?.currency ?? null}
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
          <div className="border-t border-border bg-card" style={{ flexShrink: 0, padding: "12px 20px 18px", display: "flex", alignItems: "center", gap: 11 }}>
            {canDelete && (
              <button
                type="button"
                aria-label={t("lessonDetails.deleteBtn")}
                onClick={handleDelete}
                disabled={deleting}
                className="bg-destructive/10 text-destructive" style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                {deleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 size={20} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="bg-primary text-primary-foreground ml-auto h-11 rounded-[12px] px-7 text-[15px] font-bold"
              style={{ border: "none", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif" }}
            >
              {t("lessonDetails.doneBtn")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
