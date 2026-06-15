import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LessonWorkspace } from "@/components/LessonWorkspace";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const [row, setRow] = useState<LessonRowFull | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("lessons_visible")
      .select(
        "id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, student_payment_status, meeting_url, homework, summary, student_notes, source"
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
            {sub && <div style={{ fontSize: 13.5, color: "#6b7088", marginTop: 1 }}>{sub}</div>}
          </div>
          <button onClick={() => onOpenChange(false)} aria-label="✕"
            style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, border: "none", background: "#F5F4F0", color: "#6b7088", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
        {loading || !row ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
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
      </DialogContent>
    </Dialog>
  );
}
