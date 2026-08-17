import { useMemo, useState } from "react";
import { setLessonStatus } from "@/lib/lessonActions";
import { getLocale } from "@/lib/locale";
import { useHaptic } from "@/hooks/useHaptic";
import { burstConfetti } from "@/lib/confetti";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { insertNotification } from "@/lib/notifications";
import { notifyGroupLessonCancelled } from "@/lib/groupLessons";
import { syncLessonToGoogleCalendar } from "@/lib/googleCalendarSync";
import { Check, X, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface PastLesson {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  student_id: string | null; // NULL for group lessons
  source: "hub" | "independent";
}

interface Props {
  lessons: PastLesson[];
  studentNames: Record<string, string>;
  onChanged: () => void;
}

export function NeedsMarkingCard({ lessons, studentNames, onChanged }: Props) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Optimistically hide a just-marked lesson so it vanishes INSTANTLY (binding
  // invariant) instead of spinning through the DB round-trip. Reverted on error.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const items = useMemo(() => {
    const now = Date.now();
    return lessons.filter((l) => {
      const ends = new Date(l.starts_at).getTime() + l.duration_minutes * 60 * 1000;
      return ends < now && !removedIds.has(l.id);
    });
  }, [lessons, removedIds]);

  const { success: hapticSuccess, error: hapticError } = useHaptic();

  if (items.length === 0) return null;

  const setStatus = async (id: string, status: "completed" | "cancelled") => {
    setBusyId(id);
    // Instant feedback FIRST: haptic + confetti (completed) + optimistically drop the
    // card. This is the hub tutor's primary "mark a lesson done" win too, so it gets the
    // same celebration as the independent/manager LessonCard path.
    if (status === "completed") { hapticSuccess(); burstConfetti(); }
    setRemovedIds((prev) => new Set(prev).add(id));
    const { error } = await setLessonStatus(id, status as import("@/lib/lessonActions").LessonStatus);
    setBusyId(null);
    if (error) {
      // Revert: the lesson reappears so the tutor can retry.
      setRemovedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      hapticError();
      toast.error(t("needsMarking.updateFailed"));
      return;
    }
    toast.success(status === "completed" ? t("needsMarking.markedCompleted") : t("needsMarking.markedCancelled"));
    if (status === "cancelled") {
      // Cancellation must reach the student + calendar, same as the Dashboard/Schedule
      // cancel paths — this card is the hub tutor's primary marking surface.
      const lesson = lessons.find((l) => l.id === id);
      if (lesson?.student_id) {
        insertNotification({
          userId: lesson.student_id,
          // per-lesson type dodges the 24h (user,type) notification dedup
          type: `lesson_cancelled_${id}`,
          title: t("notifications.lessonCancelledTitle", { subject: lesson.subject }),
          link: "/student/schedule",
        });
      } else if (lesson) {
        void notifyGroupLessonCancelled(id, lesson.subject);
      }
      void syncLessonToGoogleCalendar(id, "delete");
    }
    onChanged();
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="mt-6">
      <div className="rounded-[16px] border border-warning/40 bg-warning/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15">
            <Clock className="h-4 w-4 text-warning" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("needsMarking.title", { count: items.length })}
            </p>
            <p className="text-[14px] text-muted-foreground">
              {t("needsMarking.desc")}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {items.slice(0, 5).map((l) => (
            <div
              key={l.id}
              className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {l.subject} · {(l.student_id ? studentNames[l.student_id] : t("groupLessons.cardLabel")) ?? "—"}
                </p>
                <p className="text-[14px] text-muted-foreground">
                  {fmt(l.starts_at)}
                  {l.source === "hub" && (
                    <span className="ml-2 italic">{t("needsMarking.managerNote")}</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyId === l.id}
                  onClick={() => setStatus(l.id, "completed")}
                >
                  {busyId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("needsMarking.completed")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === l.id}
                  onClick={() => setStatus(l.id, "cancelled")}
                >
                  <X className="h-3.5 w-3.5" />
                  {t("needsMarking.cancelled")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
