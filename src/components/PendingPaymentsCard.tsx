import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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

interface UnpaidRow {
  id: string;
  starts_at: string;
  subject: string;
  student_id: string;
  student_price: number;
  student_name: string;
  currency: string;
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
    const { data: details } = await supabase
      .from("lesson_details")
      .select("lesson_id, student_price, lessons!inner(id, starts_at, subject, student_id, tutor_id, status)")
      .eq("lessons.tutor_id", user.id)
      .eq("lessons.status", "completed")
      .eq("student_payment_status", "unpaid")
      .gt("student_price", 0)
      .limit(100);

    const lessons = ((details ?? []) as any[])
      .map((d) => ({
        id: d.lessons.id,
        starts_at: d.lessons.starts_at,
        subject: d.lessons.subject,
        student_id: d.lessons.student_id,
        student_price: Number(d.student_price ?? 0),
      }))
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1));

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
        names[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень";
      });
      (rates ?? []).forEach((r: any) => {
        currencies[r.student_id] = r.currency ?? "UAH";
      });
    }
    setRows(
      lessons.map((l) => ({
        ...l,
        student_name: names[l.student_id] ?? "Учень",
        currency: currencies[l.student_id] ?? "UAH",
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
    const { error } = await supabase
      .from("lesson_details")
      .update({ student_payment_status: "paid" })
      .in("lesson_id", ids);
    setBusyId(null);
    if (error) {
      toast.error("Не вдалося оновити");
      return;
    }
    setRows((r) => r.filter((x) => !ids.includes(x.id)));
    toast.success(ids.length === 1 ? "Позначено як оплачено" : `Позначено ${ids.length} уроків`);
  };

  const remindStudent = async (lessonId: string) => {
    setRemindingId(lessonId);
    const { data, error } = await supabase.functions.invoke("remind-payment", {
      body: { lessonId },
    });
    setRemindingId(null);
    if (error) {
      toast.error("Не вдалося надіслати нагадування");
      return;
    }
    if ((data as any)?.success) {
      const channels = (data as any).channels as string[];
      const labels = channels.map((c) => (c === "telegram" ? "Telegram" : "email"));
      toast.success(`Нагадування надіслано: ${labels.join(" + ")}`);
    } else {
      toast.error("Учень не має ні Telegram, ні email — додайте контакт");
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
            <Badge variant="outline" className="ml-1 text-[10px]">
              {groups.length} {groups.length === 1 ? "учень" : "учнів"} · {summaryCurrency ? formatPrice(totalSum, summaryCurrency) : totalSum}
            </Badge>
            <ChevronDown
              className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link to="/finances">
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
                        <span className="text-xs text-muted-foreground">
                          · {g.lessons.length} {g.lessons.length === 1 ? "урок" : "ур."}
                        </span>
                        <span className="ml-auto text-sm font-semibold text-foreground">
                          {formatPrice(g.total, g.currency)}
                        </span>
                      </button>
                      <Button
                        size="sm"
                        className="h-8 shrink-0 gap-1"
                        onClick={() => markPaid(allIds)}
                        disabled={busy}
                        title="Позначити всі уроки цього учня як оплачені"
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
                                onClick={() => setOpenLessonId(r.id)}
                                title="Відкрити урок"
                              >
                                <p className="truncate text-xs text-foreground">
                                  {r.subject} ·{" "}
                                  {d.toLocaleDateString("uk-UA", {
                                    day: "numeric",
                                    month: "short",
                                  })}
                                </p>
                                <p className="text-xs font-medium text-muted-foreground">
                                  {formatPrice(r.student_price, r.currency)}
                                </p>
                              </button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={() => remindStudent(r.id)}
                                disabled={remindingId === r.id}
                                title="Надіслати нагадування у Telegram + email"
                              >
                                {remindingId === r.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Bell className="h-3 w-3" />
                                )}
                                Нагадати
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-xs"
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
