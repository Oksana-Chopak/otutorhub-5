import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  XCircle,
  Loader2,
  Inbox,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { toast } from "sonner";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ChangeRequestRow {
  id: string;
  lesson_id: string;
  student_id: string;
  tutor_id: string;
  kind: "cancel" | "reschedule";
  proposed_starts_at: string | null;
  reason: string | null;
  status: string;
  created_at: string;
}

interface LessonInfo {
  id: string;
  starts_at: string;
  subject: string;
  duration_minutes: number;
  student_price: number;
  status: string;
}

type ChargeChoice = "none" | "partial" | "full";

interface Props {
  nameOf: (userId: string) => string;
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function TutorChangeRequestsCard({ nameOf }: Props) {
  const { user } = useAuth();
  const { settings } = useWorkspaceSettings();
  const [requests, setRequests] = useState<ChangeRequestRow[]>([]);
  const [lessons, setLessons] = useState<Record<string, LessonInfo>>({});
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ChangeRequestRow | null>(null);
  const [chargeChoice, setChargeChoice] = useState<ChargeChoice>("none");
  const [partialAmount, setPartialAmount] = useState("0");
  const [proposedAt, setProposedAt] = useState("");
  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cancelFreeHours = (settings as any)?.cancel_free_hours ?? 24;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: reqs } = await supabase
      .from("lesson_change_requests")
      .select(
        "id, lesson_id, student_id, tutor_id, kind, proposed_starts_at, reason, status, created_at"
      )
      .eq("tutor_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const list = (reqs as ChangeRequestRow[] | null) ?? [];
    setRequests(list);
    if (list.length > 0) {
      const ids = Array.from(new Set(list.map((r) => r.lesson_id)));
      const { data: lessonRows } = await supabase
        .from("lessons")
        .select("id, starts_at, subject, duration_minutes, status, lesson_details(student_price)")
        .in("id", ids);
      const map: Record<string, LessonInfo> = {};
      for (const l of (lessonRows ?? []) as any[]) {
        const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
        map[l.id] = {
          id: l.id,
          starts_at: l.starts_at,
          subject: l.subject,
          duration_minutes: l.duration_minutes,
          status: l.status,
          student_price: Number(d?.student_price ?? 0),
        } as LessonInfo;
      }
      setLessons(map);
    } else {
      setLessons({});
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    load();
    if (!user) return;
    const channel = supabase
      .channel(`tutor_change_requests_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lesson_change_requests",
          filter: `tutor_id=eq.${user.id}`,
        },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, load]);

  const openRequest = (req: ChangeRequestRow) => {
    setActive(req);
    setResponse("");
    if (req.kind === "cancel") {
      setChargeChoice("none");
      const lesson = lessons[req.lesson_id];
      const half = lesson ? Math.round(Number(lesson.student_price) / 2) : 0;
      setPartialAmount(String(half));
    } else {
      setProposedAt(
        req.proposed_starts_at
          ? toLocalInputValue(req.proposed_starts_at)
          : toLocalInputValue(new Date().toISOString())
      );
    }
  };

  const close = () => {
    setActive(null);
    setSubmitting(false);
  };

  const approve = async () => {
    if (!active) return;
    const lesson = lessons[active.lesson_id];
    if (!lesson) {
      toast.error(t("tutorChangeRequests.lessonNotFound"));
      return;
    }
    setSubmitting(true);

    if (active.kind === "cancel") {
      let newPrice = Number(lesson.student_price);
      if (chargeChoice === "none") newPrice = 0;
      else if (chargeChoice === "partial")
        newPrice = Math.max(0, Number(partialAmount) || 0);

      const { error: lessonErr } = await supabase
        .from("lessons")
        .update({ status: "cancelled" })
        .eq("id", lesson.id);

      if (lessonErr) {
        setSubmitting(false);
        toast.error(t("tutorChangeRequests.updateFailed"), { description: lessonErr.message });
        return;
      }

      const { error: priceErr } = await supabase
        .from("lesson_details")
        .upsert({ lesson_id: lesson.id, student_price: newPrice } as any, { onConflict: "lesson_id" });
      if (priceErr) {
        setSubmitting(false);
        toast.error(t("tutorChangeRequests.priceFailed"), { description: priceErr.message });
        return;
      }
    } else {
      if (!proposedAt) {
        setSubmitting(false);
        toast.error(t("tutorChangeRequests.timeRequired"));
        return;
      }
      const newStart = new Date(proposedAt).toISOString();
      const { error: lessonErr } = await supabase
        .from("lessons")
        .update({ starts_at: newStart })
        .eq("id", lesson.id);
      if (lessonErr) {
        setSubmitting(false);
        toast.error(t("tutorChangeRequests.rescheduleFailed"), { description: lessonErr.message });
        return;
      }
    }

    const { error: reqErr } = await supabase
      .from("lesson_change_requests")
      .update({
        status: "approved",
        charge_decision:
          active.kind === "cancel" ? chargeChoice : null,
        tutor_response: response.trim() || null,
        decided_at: new Date().toISOString(),
        decided_by: user?.id,
      })
      .eq("id", active.id);

    setSubmitting(false);
    if (reqErr) {
      toast.error(t("tutorChangeRequests.requestUpdateFailed") ?? "Урок оновлено, але не вдалося оновити запит", {
        description: reqErr.message,
      });
      return;
    }
    toast.success(active.kind === "cancel" ? t("tutorChangeRequests.cancelApproved") : t("tutorChangeRequests.rescheduleApproved"));
    close();
    load();
  };

  const reject = async () => {
    if (!active) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("lesson_change_requests")
      .update({
        status: "rejected",
        tutor_response: response.trim() || null,
        decided_at: new Date().toISOString(),
        decided_by: user?.id,
      })
      .eq("id", active.id);
    setSubmitting(false);
    if (error) {
      toast.error(t("tutorChangeRequests.updateFailed"), { description: error.message });
      return;
    }
    toast.success(t("tutorChangeRequestsExtra.requestRejected"));
    close();
    load();
  };

  if (loading) return null;
  if (requests.length === 0) return null;

  const activeLesson = active ? lessons[active.lesson_id] : null;
  const hoursUntil = activeLesson
    ? Math.round(
        (new Date(activeLesson.starts_at).getTime() - Date.now()) / (1000 * 60 * 60)
      )
    : 0;
  const isLate = activeLesson ? hoursUntil < cancelFreeHours : false;

  return (
    <>
      <Card className="border-warning/40 bg-warning/[0.04]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-warning/10 text-warning">
              <Inbox className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">
                Запити від учнів ({requests.length})
              </CardTitle>
              <CardDescription>
                Скасування та перенесення уроків — підтвердіть або відхиліть.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {requests.map((req) => {
            const lesson = lessons[req.lesson_id];
            if (!lesson) return null;
            const lessonDate = format(
              new Date(lesson.starts_at),
              "d MMM, HH:mm",
              { locale: uk }
            );
            const proposedDate = req.proposed_starts_at
              ? format(new Date(req.proposed_starts_at), "d MMM, HH:mm", {
                  locale: uk,
                })
              : null;
            const Icon = req.kind === "cancel" ? CalendarX2 : CalendarClock;
            return (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background p-3"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 mt-0.5",
                      req.kind === "cancel" ? "text-destructive" : "text-primary"
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {nameOf(req.student_id)} ·{" "}
                      <span className="text-muted-foreground">{lesson.subject}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Урок: {lessonDate}
                      {proposedDate && ` · → новий час: ${proposedDate}`}
                    </p>
                    {req.reason && (
                      <p className="mt-1 text-xs text-foreground/80 italic">
                        «{req.reason}»
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {req.kind === "cancel" ? t("tutorChangeRequestsExtra.kindCancel") : t("tutorChangeRequestsExtra.kindReschedule")}
                  </Badge>
                  <Button size="sm" onClick={() => openRequest(req)}>
                    Розглянути
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!active} onOpenChange={(v) => !v && close()}>
        <DialogContent className="sm:max-w-md">
          {active && activeLesson && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {active.kind === "cancel"
                    : t("tutorChangeRequestsExtra.cancelTitle")
                    : t("tutorChangeRequestsExtra.rescheduleTitle")}
                </DialogTitle>
                <DialogDescription>
                  {nameOf(active.student_id)} · {activeLesson.subject} ·{" "}
                  {format(new Date(activeLesson.starts_at), "d MMM, HH:mm", {
                    locale: uk,
                  })}
                </DialogDescription>
              </DialogHeader>

              {active.reason && (
                <div className="rounded-lg bg-muted/40 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">{t("tutorChangeRequestsExtra.studentComment")}</p>
                  <p className="text-foreground italic">«{active.reason}»</p>
                </div>
              )}

              {active.kind === "cancel" ? (
                <div className="space-y-3">
                  <div
                    className={cn(
                      "rounded-lg border p-3 text-xs",
                      isLate
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-success/30 bg-success/5 text-success"
                    )}
                  >
                    {isLate
                      ? `⚠ До уроку ${hoursUntil < 0 ? "вже минув" : `залишилось ~${hoursUntil} год`} — менше за ваше правило (${cancelFreeHours} год). Можна нарахувати оплату.`
                      : `Запит надійшов вчасно — до уроку ще ~${hoursUntil} год (правило: ≥${cancelFreeHours} год безкоштовно).`}
                  </div>
                  <Label>{t("tutorChangeRequestsExtra.paymentLabel")}</Label>
                  <RadioGroup
                    value={chargeChoice}
                    onValueChange={(v) => setChargeChoice(v as ChargeChoice)}
                    className="grid gap-2"
                  >
                    {[
                      {
                        value: "none" as ChargeChoice,
                        title: t("tutorChangeRequestsExtra.noPay"),
                        desc: t("tutorChangeRequestsExtra.noPayDesc"),
                      },
                      {
                        value: "partial" as ChargeChoice,
                        title: t("tutorChangeRequestsExtra.partialPay"),
                        desc: `Нарахувати лише частину від ${activeLesson.student_price} ₴.`,
                      },
                      {
                        value: "full" as ChargeChoice,
                        title: t("tutorChangeRequestsExtra.fullPay"),
                        desc: `Учень платить ${activeLesson.student_price} ₴ як за проведений урок.`,
                      },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition",
                          chargeChoice === opt.value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        )}
                      >
                        <RadioGroupItem value={opt.value} className="mt-0.5" />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{opt.title}</p>
                          <p className="text-xs text-muted-foreground">{opt.desc}</p>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                  {chargeChoice === "partial" && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="partial-amount" className="text-sm">
                        Сума, ₴
                      </Label>
                      <Input
                        id="partial-amount"
                        type="number"
                        min={0}
                        max={activeLesson.student_price}
                        value={partialAmount}
                        onChange={(e) => setPartialAmount(e.target.value)}
                        className="w-28"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="proposed-time">{t("tutorChangeRequestsExtra.newTimeLabel")}</Label>
                  <Input
                    id="proposed-time"
                    type="datetime-local"
                    value={proposedAt}
                    onChange={(e) => setProposedAt(e.target.value)}
                  />
                  {active.proposed_starts_at && (
                    <p className="text-xs text-muted-foreground">
                      Учень запропонував:{" "}
                      {format(new Date(active.proposed_starts_at), "d MMMM, HH:mm", {
                        locale: uk,
                      })}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="t-response">{t("tutorChangeRequestsExtra.responseLabel")}</Label>
                <Textarea
                  id="t-response"
                  rows={2}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder={t("tutorChangeRequestsExtra.responsePlaceholder")}
                  maxLength={500}
                />
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="ghost"
                  onClick={reject}
                  disabled={submitting}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <XCircle className="mr-1 h-4 w-4" />
                  Відхилити
                </Button>
                <Button onClick={approve} disabled={submitting}>
                  {submitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Підтвердити
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
