import { useEffect, useState } from "react";
import { DateTimeField } from "@/components/DateTimeField";
import { useTimeZones } from "@/hooks/useTimeZones";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AREA_CLASS, FieldLabel } from "@/components/form/canon";
import { FormSheet, SheetButton } from "@/components/form/FormSheet";
import { Badge } from "@/components/ui/badge";
import { CalendarX2, CalendarClock, Loader2, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { insertNotification } from "@/lib/notifications";
import { useHaptic } from "@/hooks/useHaptic";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

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
  const zones = useTimeZones([tutorId]);   // 14.11: позначка назве час репетитора, якщо він інший
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [proposedAt, setProposedAt] = useState(toLocalInputValue(startsAt));
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const haptic = useHaptic();

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

  /* §4 аудиту шляхів 24.09: «своєї заявки на перенесення учень скасувати не
     може». Тут був ЛИШЕ напис: передумав — і заявка висить, поки репетитор не
     відповість; людина або пише в чат, або приходить на урок, який сама ж
     просила перенести. База це дозволяла з квітня (політика «Student cancels
     own pending request»: свій рядок, статус pending → cancelled) — бракувало
     саме кнопки. */
  const withdraw = async () => {
    if (!pending || !user) return;
    setWithdrawing(true);
    const { error } = await supabase
      .from("lesson_change_requests")
      .update({ status: "cancelled" })
      .eq("id", pending.id)
      .eq("student_id", user.id);
    setWithdrawing(false);
    if (error) {
      haptic.error();
      toast.error(t("studentLessonActionsExtra.withdrawFailed"), { description: error.message });
      return;
    }
    haptic.success();
    toast.success(t("studentLessonActionsExtra.withdrawDone"));
    /* Репетитор МУСИТЬ дізнатись: він міг саме дивитись на цю заявку. Тип
       несе урок, бо `create_notification` дедуплікує за (user_id, type) на
       добу — зі спільним типом друге скасування за день не дійшло б. */
    insertNotification({
      userId: tutorId,
      type: `lesson_request_withdrawn_${lessonId}`,
      title: t("notifications.lessonRequestWithdrawnTitle", {
        name: user.email?.split("@")[0] ?? t("shared.student"),
      }),
      link: "/schedule",
    });
    setPending(null);
  };

  if (pending) {
    return (
      <div className="flex flex-wrap items-center gap-1">
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
        <Button
          size="sm"
          variant="ghost"
          className="h-11 px-2 text-[14px] text-muted-foreground hover:text-destructive"
          onClick={withdraw}
          disabled={withdrawing}
        >
          {withdrawing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          <span className="whitespace-nowrap">{t("studentLessonActionsExtra.withdrawBtn")}</span>
        </Button>
      </div>
    );
  }

  const submitCancel = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
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
      insertNotification({
        userId: tutorId,
        type: "lesson_request",
        title: t("notifications.lessonCancelTitle", { name: user?.email?.split("@")[0] ?? t("shared.student") }),
        link: "/schedule",
      });
      setReason("");
      setCancelOpen(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const submitReschedule = async () => {
    if (!user) return;
    if (!proposedAt) {
      toast.error(t("studentLessonActions.timeRequired"));
      return;
    }
    // 14.11: поле відкривається з чинним часом уроку — запит «перенести на той самий час»
    // нічого не просив, а репетитор отримував сповіщення і мав його розглядати.
    if (new Date(proposedAt).getTime() === new Date(startsAt).getTime()) {
      toast.error(t("studentLessonActions.sameTime"));
      return;
    }
    setSubmitting(true);
    try {
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
      toast.success(t("studentLessonActionsExtra.rescheduleSent"));
      insertNotification({
        userId: tutorId,
        type: "lesson_request",
        title: t("notifications.lessonRequestTitle", { name: user?.email?.split("@")[0] ?? t("shared.student") }),
        link: "/schedule",
      });
      setReason("");
      setRescheduleOpen(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const lessonDate = format(new Date(startsAt), "d MMMM, HH:mm", { locale: uk });

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-11 px-2 text-[14px] text-muted-foreground hover:text-primary"
        onClick={() => setRescheduleOpen(true)}
        title={t("studentLessonActionsExtra.rescheduleTitle")}
      >
        {/* Аудит шляхів 24.09 (§4, учень): на телефоні тут були ДВІ ІКОНКИ без
            підписів — «перенести» і «скасувати» відрізнити неможливо, а title на
            тачі недосяжний. Підпис тепер завжди видимий. */}
        <CalendarClock className="h-3.5 w-3.5 mr-1" />
        <span className="whitespace-nowrap">{t("studentLessonActionsExtra.rescheduleBtn")}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-11 px-2 text-[14px] text-muted-foreground hover:text-destructive"
        onClick={() => setCancelOpen(true)}
        title={t("studentLessonActionsExtra.cancelTitle2")}
      >
        <CalendarX2 className="h-3.5 w-3.5 mr-1" />
        <span className="whitespace-nowrap">{t("studentLessonActionsExtra.cancelBtn2")}</span>
      </Button>

      {/* Cancel dialog — 14.11: оболонка й поля з канону форм */}
      <FormSheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        locked={submitting}
        testId="student-cancel"
        title={t("studentLessonActionsExtra.cancelDialogTitle")}
        description={t("studentLessonActionsExtra.cancelDialogDesc", { date: lessonDate })}
        footer={
          <>
            <SheetButton kind="secondary" onClick={() => setCancelOpen(false)}>{t("common.close")}</SheetButton>
            <SheetButton kind="danger" onClick={submitCancel} busy={submitting}>{t("studentLessonActionsExtra.sendRequestBtn")}</SheetButton>
          </>
        }
      >
        <div>
          <FieldLabel htmlFor="cancel-reason">{t("studentLessonActionsExtra.cancelReasonLabel")}</FieldLabel>
          <Textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("studentLessonActionsExtra.cancelReasonPlaceholder")}
            maxLength={500}
            className={AREA_CLASS}
          />
        </div>
      </FormSheet>

      {/* Reschedule dialog */}
      <FormSheet
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        locked={submitting}
        testId="student-reschedule"
        title={t("studentLessonActionsExtra.rescheduleDialogTitle")}
        description={t("studentLessonActionsExtra.rescheduleDialogDesc", { date: lessonDate })}
        footer={
          <>
            <SheetButton kind="secondary" onClick={() => setRescheduleOpen(false)}>{t("common.close")}</SheetButton>
            <SheetButton onClick={submitReschedule} busy={submitting}>{t("studentLessonActionsExtra.sendRequestBtn")}</SheetButton>
          </>
        }
      >
        <div>
          <FieldLabel>{t("studentLessonActionsExtra.newTimeLabel")}</FieldLabel>
          <DateTimeField value={proposedAt} onChange={setProposedAt} min={toLocalInputValue(new Date().toISOString())} zoneNote="others" zonePeople={[{ name: t("roles.tutor"), tz: zones[tutorId] }]} />
        </div>
        <div>
          <FieldLabel htmlFor="r-reason">{t("studentLessonActionsExtra.commentLabel")}</FieldLabel>
          <Textarea
            id="r-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("studentLessonActionsExtra.commentPlaceholder")}
            maxLength={500}
            className={AREA_CLASS}
          />
        </div>
      </FormSheet>
    </>
  );
}
