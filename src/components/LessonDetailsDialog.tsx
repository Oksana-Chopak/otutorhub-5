import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LessonWorkspace } from "@/components/LessonWorkspace";
import { Loader2 } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {row
              ? `${row.subject} · ${new Date(row.starts_at).toLocaleString(
                  i18n.language === "sv" ? "sv-SE" : i18n.language === "en" ? "en-GB" : "uk-UA",
                  { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
                )}`
              : t("lessonDetails.fallbackTitle")}
          </DialogTitle>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
