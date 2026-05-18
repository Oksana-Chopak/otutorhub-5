import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CalendarX2, CalendarClock, Loader2, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { uk } from "date-fns/locale";

interface Props {
  lessonId: string;
  tutorId: string;
  startsAt: string;
  status: string;
}

interface PendingRequest {
  id: string;
  kind: "cancel" | "reschedule";
  proposed_starts_at: string | null;
  status: string;
  reason: string | null;
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function StudentLessonActions({ lessonId, tutorId, startsAt, status }: Props) {
  const { user } = useAuth();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [proposedAt, setProposedAt] = useState(toLocalInputValue(startsAt));
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("lesson_change_requests")
      .select("id, kind, proposed_starts_at, status, reason")
      .eq("lesson_id", lessonId)
      .eq("student_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setPending((data as PendingRequest | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, user?.id]);

  if (status !== "scheduled") return null;
  if (loading) return null;

  if (pending) {
    return (
      <Badge
        variant="secondary"
        className="gap-1 border-warning/30 bg-warning/10 text-warning"
        title={pending.reason ?? undefined}
      >
        <Hourglass className="h-3 w-3" />
        {pending.kind === "cancel"
          ? t("studentLessonActions.cancelRequest")
          : t("studentLessonActions.rescheduleRequest")}
      </Badge>
    );
  }

  const submitCancel = async () => {
    if (!user) return;
    setSubmitting(true);
    const { error } = await supabase.from("lesson_change_requests").insert({
      lesson_id: lessonId,
      student_id: user.id,
      tutor_id: tutorId,
      kind: "cancel",
      reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(t("studentLessonActions.requestFailed"), { description: error.message });
      return;
    }
    toast.success(t("studentLessonActions.cancelSent"), {
      description: t("studentLessonActions.cancelSentDesc"),
    });
    setReason("");
    setCancelOpen(false);
    load();
  };

  const submitReschedule = async () => {
    if (!user) return;
    if (!proposedAt) {
      toast.error(t("studentLessonActions.timeRequired"));
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("lesson_change_requests").insert({
      lesson_id: lessonId,
      student_id: user.id,
      tutor_id: tutorId,
      kind: "reschedule",
      proposed_starts_at: new Date(proposedAt).toISOString(),
      reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(t("studentLessonActions.requestFailed"), { description: error.message });
      return;
    }
    toast.success("Запит на перенесення надіслано");
    setReason("");
    setRescheduleOpen(false);
    load();
  };

  const lessonDate = format(new Date(startsAt), "d MMMM, HH:mm", { locale: uk });

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs text-muted-foreground hover:text-primary"
        onClick={() => setRescheduleOpen(true)}
        title="Запит на перенесення"
      >
        <CalendarClock className="h-3.5 w-3.5 sm:mr-1" />
        <span className="hidden sm:inline">Перенести</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
        onClick={() => setCancelOpen(true)}
        title="Запит на скасування"
      >
        <CalendarX2 className="h-3.5 w-3.5 sm:mr-1" />
        <span className="hidden sm:inline">Скасувати</span>
      </Button>

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Скасувати урок?</DialogTitle>
            <DialogDescription>
              Урок {lessonDate}. Репетитор підтвердить ваш запит. Якщо до
              початку залишилось мало часу, репетитор може нарахувати оплату за
              урок повністю або частково — згідно з його правилами.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Причина (опційно)</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Коротко поясніть причину…"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Закрити
            </Button>
            <Button
              variant="destructive"
              onClick={submitCancel}
              disabled={submitting}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Надіслати запит
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule dialog */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Запит на перенесення</DialogTitle>
            <DialogDescription>
              Урок {lessonDate}. Запропонуйте новий час — репетитор підтвердить
              або відхилить.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="proposed-at">Бажаний новий час</Label>
              <Input
                id="proposed-at"
                type="datetime-local"
                value={proposedAt}
                onChange={(e) => setProposedAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-reason">Коментар (опційно)</Label>
              <Textarea
                id="r-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Чому потрібно перенести?"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>
              Закрити
            </Button>
            <Button onClick={submitReschedule} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Надіслати запит
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
