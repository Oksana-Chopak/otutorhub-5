import { useEffect, useState } from "react";
import { getLocale } from "@/lib/locale";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafeBulk } from "@/lib/lessonDetailsSafe";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  CheckCircle2,
  Wallet,
  ArrowRight,
  ChevronDown,
  Bell,
} from "lucide-react";
import { toast } from "sonner";
import { LessonDetailsDialog } from "@/components/LessonDetailsDialog";
import { formatPrice } from "@/lib/currency";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface UnpaidRow {
  id: string;            // row key + payment target: lesson_id (individual) | participant_id (group)
  lesson_id: string;     // the actual lesson id (for opening the dialog)
  starts_at: string;
  subject: string;
  student_id: string;
  student_price: number;
  student_name: string;
  currency: string;
  kind: "individual" | "group";
}

interface StudentGroup {
  student_id: string;
  student_name: string;
  total: number;
  currency: string;
  lessons: UnpaidRow[];
}

/**
 * Dashboard card for tutors. Shows aggregated debt summary
 * ("3 учні · 1 800 ₴"), and on expand groups unpaid lessons by student
 * with a one-click "Отримано" action per lesson and per student.
 */
export function PendingPaymentsCard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UnpaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    // Read student money through the masked lessons_visible view (student_price is
    // GRANT-locked on lesson_details; the view exposes it only to manager / the
    // owning independent tutor / the student — a hub tutor gets NULL and so no rows).
    const { data: details } = await supabase
      .from("lessons_visible")
      .select("id, starts_at, subject, student_id, tutor_id, status, student_price, student_payment_status")
      .eq("tutor_id", user.id)
      .eq("status", "completed")
      .eq("student_payment_status", "unpaid")
      .gt("student_price", 0)
      .limit(100);

    // GROUP lessons have no shared lesson_details row — the per-student unpaid amount
    // lives on lesson_participants. Pull the tutor's group lessons' unpaid participants.
    const { data: gParts } = await supabase
      .from("lesson_participants")
      .select("id, student_id, student_price, currency, student_payment_status, lessons!inner(id, starts_at, subject, tutor_id, status)")
      .eq("lessons.tutor_id", user.id)
      .eq("lessons.status", "completed")
      .eq("student_payment_status", "unpaid")
      .gt("student_price", 0)
      .limit(100);

    const lessons = [
      ...((details ?? []) as any[]).map((d) => ({
        id: d.id,
        lesson_id: d.id,
        starts_at: d.starts_at,
        subject: d.subject,
        student_id: d.student_id,
        student_price: Number(d.student_price ?? 0),
        kind: "individual" as const,
        currency: undefined as string | undefined,
      })),
      ...((gParts ?? []) as any[]).filter((p) => p.lessons).map((p) => ({
        id: p.id,
        lesson_id: p.lessons.id,
        starts_at: p.lessons.starts_at,
        subject: p.lessons.subject,
        student_id: p.student_id,
        student_price: Number(p.student_price ?? 0),
        kind: "group" as const,
        currency: (p.currency ?? "UAH") as string | undefined, // group rows carry own currency
      })),
    ].sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1));

    const ids = Array.from(new Set(lessons.map((l) => l.student_id)));
    const names: Record<string, string> = {};
    const currencies: Record<string, string> = {};
    if (ids.length) {
      const [{ data: profs }, { data: rates }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", ids),
        supabase
          .from("student_rates")
          .select("student_id, currency")
          .eq("tutor_id", user.id)
          .in("student_id", ids),
      ]);
      (profs ?? []).forEach((p: any) => {
        names[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("shared.student");
      });
      (rates ?? []).forEach((r: any) => {
        currencies[r.student_id] = r.currency ?? "UAH";
      });
    }
    setRows(
      lessons.map((l) => ({
        ...l,
        student_name: names[l.student_id] ?? t("pendingPayments.studentFallback"),
        // group rows carry their own currency; individual rows take the pair's rate currency
        currency: l.currency ?? currencies[l.student_id] ?? "UAH",
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const markPaid = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusyId(ids.join(","));
    // Route each row to the right table: individual → lesson_details (by lesson_id),
    // group participant → lesson_participants (by its own id).
    const targeted = rows.filter((r) => ids.includes(r.id));
    const indLessonIds = targeted.filter((r) => r.kind !== "group").map((r) => r.id);
    const grpPartIds = targeted.filter((r) => r.kind === "group").map((r) => r.id);
    const nowIso = new Date().toISOString();
    const results = await Promise.all([
      indLessonIds.length
        ? updateLessonDetailsSafeBulk(indLessonIds, { student_payment_status: "paid" })
        : Promise.resolve({ error: null }),
      grpPartIds.length
        ? supabase.from("lesson_participants").update({ student_payment_status: "paid", student_paid_at: nowIso }).in("id", grpPartIds)
        : Promise.resolve({ error: null }),
    ]);
    setBusyId(null);
    if (results.some((r) => (r as any).error)) {
      toast.error(t("pendingPayments.updateFailed"));
      return;
    }
    setRows((r) => r.filter((x) => !ids.includes(x.id)));
    toast.success(t("pendingPaymentsExtra.markedPaid_one"));
  };

  const remindStudent = async (lessonId: string) => {
    setRemindingId(lessonId);
    const { data, error } = await supabase.functions.invoke("remind-payment", {
      body: { lessonId },
    });
    setRemindingId(null);
    if (error) {
      toast.error(t("pendingPayments.reminderFailed"));
      return;
    }
    if ((data as any)?.success) {
      const channels = (data as any).channels as string[];
      const labels = channels.map((c) => (c === "telegram" ? "Telegram" : "email"));
      toast.success(t("pendingPayments.reminderSent", { labels: labels.join(" + ") }));
    } else {
      toast.error(t("pendingPaymentsExtra.noContact"));
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) return null;

  // Group by student
  const groupMap = new Map<string, StudentGroup>();
  for (const r of rows) {
    const g = groupMap.get(r.student_id) ?? {
      student_id: r.student_id,
      student_name: r.student_name,
      total: 0,
      currency: r.currency,
      lessons: [] as UnpaidRow[],
    };
    g.total += r.student_price;
    g.lessons.push(r);
    groupMap.set(r.student_id, g);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => b.total - a.total);
  const totalSum = rows.reduce((s, r) => s + r.student_price, 0);
  // If all unpaid lessons share one currency, show it in summary; otherwise omit symbol.
  const summaryCurrency = (() => {
    const set = new Set(groups.map((g) => g.currency));
    return set.size === 1 ? Array.from(set)[0] : null;
  })();

  return (
    <Card className="border-warning/40 bg-gradient-to-br from-warning/5 to-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CollapsibleTrigger className="group flex flex-1 items-center gap-2 text-left">
            <Wallet className="h-4 w-4 text-warning shrink-0" />
            <CardTitle className="font-display text-base">
              Очікують оплати
            </CardTitle>
            <Badge variant="outline" className="ml-1 text-[14px]">
              {t("pendingPaymentsExtra.studentCount", { count: groups.length })} · {summaryCurrency ? formatPrice(totalSum, summaryCurrency) : totalSum}
            </Badge>
            <ChevronDown
              className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[14px]">
            <Link to="/finances?filter=need_pay">
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border">
              {groups.map((g) => {
                const expanded = expandedStudent === g.student_id;
                const allIds = g.lessons.map((l) => l.id);
                const busy = busyId === allIds.join(",");
                return (
                  <li key={g.student_id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedStudent(expanded ? null : g.student_id)
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                            expanded ? "rotate-180" : "-rotate-90"
                          }`}
                        />
                        <span className="truncate text-sm font-medium text-foreground">
                          {g.student_name}
                        </span>
                        <span className="text-[14px] text-muted-foreground">
                          · {t("pendingPaymentsExtra.lessonCount", { count: g.lessons.length })}
                        </span>
                        <span className="ml-auto text-sm font-semibold text-foreground">
                          {formatPrice(g.total, g.currency)}
                        </span>
                      </button>
                      <Button
                        size="sm"
                        className="h-10 shrink-0 gap-1"
                        onClick={() => markPaid(allIds)}
                        disabled={busy}
                        title={t("pendingPaymentsExtra.markAllPaid")}
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Усі
                      </Button>
                    </div>
                    {expanded && (
                      <ul className="mt-2 space-y-1 pl-5">
                        {g.lessons.map((r) => {
                          const d = new Date(r.starts_at);
                          const oneBusy = busyId === r.id;
                          return (
                            <li
                              key={r.id}
                              className="flex items-center justify-between gap-2 rounded-md bg-secondary/30 px-2 py-1.5"
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left hover:opacity-80"
                                onClick={() => setOpenLessonId(r.lesson_id)}
                                title={t("pendingPaymentsExtra.openLesson")}
                              >
                                <p className="truncate text-[14px] text-foreground">
                                  {r.subject} ·{" "}
                                  {d.toLocaleDateString(getLocale(), {
                                    day: "numeric",
                                    month: "short",
                                  })}
                                </p>
                                <p className="text-[14px] font-medium text-muted-foreground">
                                  {formatPrice(r.student_price, r.currency)}
                                </p>
                              </button>
                              {r.kind !== "group" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 px-2 text-[14px]"
                                  onClick={() => remindStudent(r.id)}
                                  disabled={remindingId === r.id}
                                  title={t("pendingPaymentsExtra.sendReminder")}
                                >
                                  {remindingId === r.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Bell className="h-3 w-3" />
                                  )}
                                  Нагадати
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-[14px]"
                                onClick={() => markPaid([r.id])}
                                disabled={oneBusy}
                              >
                                {oneBusy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3 w-3" />
                                )}
                                Отримано
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
      <LessonDetailsDialog
        lessonId={openLessonId}
        open={!!openLessonId}
        onOpenChange={(o) => !o && setOpenLessonId(null)}
        onUpdated={load}
      />
    </Card>
  );
}
