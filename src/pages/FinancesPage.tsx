import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  DollarSign,
  Loader2,
  Download,
  CheckCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { FinanceWeeklyChart } from "@/components/FinanceWeeklyChart";
import { Percent } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { MobileFilters } from "@/components/MobileFilters";

type PaymentStatus = "paid" | "unpaid";
type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";

interface LessonRow {
  id: string;
  subject: string;
  starts_at: string;
  status: LessonStatus;
  student_id: string;
  tutor_id: string;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PaymentStatus;
  tutor_payout_status: PaymentStatus;
  student_paid_at: string | null;
  tutor_paid_at: string | null;
}

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

const monthKey = (iso: string) => iso.slice(0, 7);
const formatMonth = (key: string) => {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
};
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export default function FinancesPage() {
  const { roles } = useAuth();
  const { isIndependent } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isIndependentTutor = isTutor && !isManager && isIndependent;

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [tutorFilter, setTutorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all|need_pay|need_payout|done
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: lessonsData, error: lErr }, { data: profilesData, error: pErr }] =
      await Promise.all([
        supabase
          .from("lessons")
          .select(
            "id, subject, starts_at, status, student_id, tutor_id, lesson_details!inner(student_price, tutor_payout, student_payment_status, tutor_payout_status, student_paid_at, tutor_paid_at)"
          )
          .order("starts_at", { ascending: false }),
        supabase.from("profiles").select("id, first_name, last_name"),
      ]);
    if (lErr) toast.error("ÐÐ¾Ð¼Ð¸Ð»ÐºÐ° Ð·Ð°Ð²Ð°Ð½ÑÐ°Ð¶ÐµÐ½Ð½Ñ ÑÑÐ¾ÐºÑÐ²");
    if (pErr) toast.error("ÐÐ¾Ð¼Ð¸Ð»ÐºÐ° Ð·Ð°Ð²Ð°Ð½ÑÐ°Ð¶ÐµÐ½Ð½Ñ Ð¿ÑÐ¾ÑÑÐ»ÑÐ²");
    const mapped: LessonRow[] = ((lessonsData ?? []) as any[]).map((l) => ({
      id: l.id,
      subject: l.subject,
      starts_at: l.starts_at,
      status: l.status,
      student_id: l.student_id,
      tutor_id: l.tutor_id,
      student_price: Number(l.lesson_details?.student_price ?? 0),
      tutor_payout: Number(l.lesson_details?.tutor_payout ?? 0),
      student_payment_status: (l.lesson_details?.student_payment_status ?? "unpaid") as PaymentStatus,
      tutor_payout_status: (l.lesson_details?.tutor_payout_status ?? "unpaid") as PaymentStatus,
      student_paid_at: l.lesson_details?.student_paid_at ?? null,
      tutor_paid_at: l.lesson_details?.tutor_paid_at ?? null,
    }));
    setLessons(mapped);
    const map: Record<string, Profile> = {};
    (profilesData ?? []).forEach((p) => (map[p.id] = p as Profile));
    setProfiles(map);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const nameOf = (id: string) => {
    const p = profiles[id];
    if (!p) return "â";
    return `${p.first_name} ${p.last_name}`.trim() || "ÐÐµÐ· ÑÐ¼ÐµÐ½Ñ";
  };

  const months = useMemo(() => {
    const set = new Set(lessons.map((l) => monthKey(l.starts_at)));
    return Array.from(set).sort().reverse();
  }, [lessons]);

  const tutorOptions = useMemo(() => {
    const ids = Array.from(new Set(lessons.map((l) => l.tutor_id)));
    return ids
      .map((id) => ({ id, name: nameOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, profiles]);

  const filtered = useMemo(
    () =>
      lessons.filter(
        (l) =>
          (monthFilter === "all" || monthKey(l.starts_at) === monthFilter) &&
          (tutorFilter === "all" || l.tutor_id === tutorFilter)
      ),
    [lessons, monthFilter, tutorFilter]
  );

  // Billable = lesson actually counts toward money flow.
  // Includes: completed lessons, past lessons (date already passed), or any lesson
  // that has a payment marked (e.g. independent tutor pre-paid scheduled lesson).
  // Excludes: cancelled, and pending requests that never happened.
  const nowMs = Date.now();
  const billable = filtered.filter((l) => {
    if (l.status === "cancelled" || l.status === "pending") return false;
    if (l.status === "completed") return true;
    const isPast = new Date(l.starts_at).getTime() < nowMs;
    const hasPayment =
      l.student_payment_status === "paid" || l.tutor_payout_status === "paid";
    return isPast || hasPayment;
  });

  const visibleRows = useMemo(() => {
    switch (statusFilter) {
      case "need_pay":
        return billable.filter((l) => l.student_payment_status === "unpaid");
      case "need_payout":
        return billable.filter((l) => l.tutor_payout_status === "unpaid");
      case "done":
        return billable.filter(
          (l) =>
            l.student_payment_status === "paid" && l.tutor_payout_status === "paid"
        );
      default:
        return billable;
    }
  }, [billable, statusFilter]);

  const totalIncome = billable
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const totalExpense = billable
    .filter((l) => l.tutor_payout_status === "paid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);
  const profit = totalIncome - totalExpense;
  const pendingIncome = billable
    .filter((l) => l.student_payment_status === "unpaid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const pendingExpense = billable
    .filter((l) => l.tutor_payout_status === "unpaid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);

  // Markup % ("Ð¼Ð°ÑÐ¶Ð°" ÑÐº Ð½Ð°ÑÑÐ½ÐºÐ°): (income - payout) / payout * 100
  // Ð Ð°ÑÑÑÐ¼Ð¾ ÑÑÐ»ÑÐºÐ¸ Ð¿Ð¾ ÑÑÐ¾ÐºÐ°Ñ, Ð´Ðµ Ð²ÑÐ´Ð¾Ð¼Ñ Ð¾Ð±Ð¸Ð´Ð²Ñ ÑÑÐ¼Ð¸ (price > 0 Ñ payout > 0),
  // ÑÐ½Ð°ÐºÑÐµ Ð½Ð°ÑÑÐ½ÐºÐ° Ð½Ðµ Ð²Ð¸Ð·Ð½Ð°ÑÐµÐ½Ð°.
  const computeMarkup = (rows: LessonRow[]): number | null => {
    const valid = rows.filter(
      (l) => Number(l.student_price) > 0 && Number(l.tutor_payout) > 0
    );
    if (valid.length === 0) return null;
    const income = valid.reduce((s, l) => s + Number(l.student_price), 0);
    const payout = valid.reduce((s, l) => s + Number(l.tutor_payout), 0);
    if (payout === 0) return null;
    return ((income - payout) / payout) * 100;
  };

  const hubMarkup = useMemo(() => computeMarkup(billable), [billable]);

  const markupByTutor = useMemo(() => {
    const groups: Record<string, LessonRow[]> = {};
    billable.forEach((l) => {
      if (!groups[l.tutor_id]) groups[l.tutor_id] = [];
      groups[l.tutor_id].push(l);
    });
    return Object.entries(groups)
      .map(([tutorId, rows]) => ({
        tutorId,
        name: nameOf(tutorId),
        markup: computeMarkup(rows),
        lessonsCount: rows.length,
      }))
      .filter((r) => r.markup !== null)
      .sort((a, b) => (b.markup ?? 0) - (a.markup ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable, profiles]);

  const togglePayment = async (
    lesson: LessonRow,
    field: "student_payment_status" | "tutor_payout_status"
  ) => {
    const next: PaymentStatus = lesson[field] === "paid" ? "unpaid" : "paid";
    const nextPaidAt =
      next === "paid" ? new Date().toISOString() : null;
    const paidAtField =
      field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";

    // Optimistic update â no full page reload, no jump.
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lesson.id
          ? { ...l, [field]: next, [paidAtField]: nextPaidAt } as LessonRow
          : l
      )
    );

    const payload =
      field === "student_payment_status"
        ? { student_payment_status: next }
        : { tutor_payout_status: next };
    const { error } = await supabase
      .from("lesson_details")
      .update(payload)
      .eq("lesson_id", lesson.id);
    if (error) {
      // Roll back
      setLessons((prev) =>
        prev.map((l) =>
          l.id === lesson.id
            ? {
                ...l,
                [field]: lesson[field],
                [paidAtField]:
                  field === "student_payment_status"
                    ? lesson.student_paid_at
                    : lesson.tutor_paid_at,
              } as LessonRow
            : l
        )
      );
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð¾Ð½Ð¾Ð²Ð¸ÑÐ¸ ÑÑÐ°ÑÑÑ");
      return;
    }
    toast.success(next === "paid" ? "ÐÐ¾Ð·Ð½Ð°ÑÐµÐ½Ð¾ ÑÐº Ð¾Ð¿Ð»Ð°ÑÐµÐ½Ð¾" : "Ð¡ÐºÐ¸Ð½ÑÑÐ¾ Ð½Ð° Ð½ÐµÐ¾Ð¿Ð»Ð°ÑÐµÐ½Ð¾");
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === visibleRows.length && visibleRows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleRows.map((r) => r.id)));
    }
  };

  const bulkMark = async (field: "student_payment_status" | "tutor_payout_status") => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const nowIso = new Date().toISOString();
    const payload =
      field === "student_payment_status"
        ? { student_payment_status: "paid" as PaymentStatus }
        : { tutor_payout_status: "paid" as PaymentStatus };
    // Optimistic
    const paidAtField =
      field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";
    const previousLessons = lessons;
    setLessons((prev) =>
      prev.map((l) =>
        ids.includes(l.id) ? ({ ...l, [field]: "paid", [paidAtField]: nowIso } as LessonRow) : l
      )
    );
    const { error } = await supabase
      .from("lesson_details")
      .update(payload)
      .in("lesson_id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error("ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð¾Ð½Ð¾Ð²Ð¸ÑÐ¸ Ð·Ð°Ð¿Ð¸ÑÐ¸");
      setLessons(previousLessons);
      return;
    }
    toast.success(`ÐÐ½Ð¾Ð²Ð»ÐµÐ½Ð¾ ${ids.length} Ð·Ð°Ð¿Ð¸ÑÑÐ²`);
    setSelected(new Set());
  };

  const exportCsv = () => {
    const header = [
      "ÐÐ°ÑÐ°",
      "ÐÑÐµÐ´Ð¼ÐµÑ",
      "Ð£ÑÐµÐ½Ñ",
      "Ð¦ÑÐ½Ð° ÑÑÐ½Ñ (â´)",
      "Ð¡ÑÐ°ÑÑÑ Ð¾Ð¿Ð»Ð°ÑÐ¸ ÑÑÐ½Ñ",
      "ÐÐ°ÑÐ° Ð¾Ð¿Ð»Ð°ÑÐ¸ ÑÑÐ½Ñ",
      "Ð ÐµÐ¿ÐµÑÐ¸ÑÐ¾Ñ",
      "ÐÐ¸Ð¿Ð»Ð°ÑÐ° (â´)",
      "Ð¡ÑÐ°ÑÑÑ Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸",
      "ÐÐ°ÑÐ° Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸",
      "ÐÑÐ¸Ð±ÑÑÐ¾Ðº (â´)",
    ];
    const rows = visibleRows.map((l) => [
      formatDate(l.starts_at),
      l.subject,
      nameOf(l.student_id),
      String(l.student_price),
      l.student_payment_status === "paid" ? "ÐÐ¿Ð»Ð°ÑÐµÐ½Ð¾" : "ÐÑÑÐºÑÑ",
      l.student_paid_at ? formatDate(l.student_paid_at) : "",
      nameOf(l.tutor_id),
      String(l.tutor_payout),
      l.tutor_payout_status === "paid" ? "ÐÐ¸Ð¿Ð»Ð°ÑÐµÐ½Ð¾" : "ÐÑÑÐºÑÑ",
      l.tutor_paid_at ? formatDate(l.tutor_paid_at) : "",
      String(Number(l.student_price) - Number(l.tutor_payout)),
    ]);
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finances_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 150);
    toast.success("CSV Ð·Ð°Ð²Ð°Ð½ÑÐ°Ð¶ÐµÐ½Ð¾");
  };

  const allSelected = selected.size === visibleRows.length && visibleRows.length > 0;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <AppLayout>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">Ð¤ÑÐ½Ð°Ð½ÑÐ¸</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isIndependentTutor
              ? "ÐÐ¿Ð»Ð°ÑÐ¸ Ð²ÑÐ´ Ð²Ð°ÑÐ¸Ñ ÑÑÐ½ÑÐ²"
              : "ÐÐ¿Ð»Ð°ÑÐ¸ Ð²ÑÐ´ ÑÑÐ½ÑÐ² ÑÐ° Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°Ð¼"}
          </p>
        </div>
        <MobileFilters
          activeCount={
            (monthFilter !== "all" ? 1 : 0) +
            (tutorFilter !== "all" ? 1 : 0) +
            (statusFilter !== "all" ? 1 : 0)
          }
          className="w-full sm:w-auto"
        >
          {!isIndependentTutor && (
            <div className="w-full sm:w-44">
              <Select value={tutorFilter} onValueChange={setTutorFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Ð ÐµÐ¿ÐµÑÐ¸ÑÐ¾Ñ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ÐÑÑ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ¸</SelectItem>
                  {tutorOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="w-full sm:w-44">
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="ÐÐµÑÑÐ¾Ð´" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ÐÑÑ Ð¿ÐµÑÑÐ¾Ð´Ð¸</SelectItem>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatMonth(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Ð¡ÑÐ°ÑÑÑ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ÐÑÑ ÑÑÐ°ÑÑÑÐ¸</SelectItem>
                <SelectItem value="need_pay">ÐÑÑÐºÑÑ Ð¾Ð¿Ð»Ð°ÑÐ¸ ÑÑÐ½Ñ</SelectItem>
                {!isIndependentTutor && (
                  <SelectItem value="need_payout">ÐÑÑÐºÑÑ Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸</SelectItem>
                )}
                {!isIndependentTutor && (
                  <SelectItem value="done">ÐÑÐµ Ð·Ð°ÐºÑÐ¸ÑÐ¾</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </MobileFilters>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> ÐÐ°Ð²Ð°Ð½ÑÐ°Ð¶ÐµÐ½Ð½Ñ...
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${isIndependentTutor ? "lg:grid-cols-2" : "lg:grid-cols-4 xl:grid-cols-5"}`}>
            <StatCard
              label={isIndependentTutor ? "ÐÑÑÐ¸Ð¼Ð°Ð½Ð¾" : "ÐÐ°Ð´ÑÐ¾Ð´Ð¶ÐµÐ½Ð½Ñ"}
              value={`${totalIncome} â´`}
              icon={ArrowDownLeft}
              variant="success"
            />
            {!isIndependentTutor && (
              <StatCard label="ÐÐ¸Ð¿Ð»Ð°ÑÐ¸" value={`${totalExpense} â´`} icon={ArrowUpRight} />
            )}
            {!isIndependentTutor && (
              <StatCard
                label="ÐÑÐ¸Ð±ÑÑÐ¾Ðº"
                value={`${profit} â´`}
                icon={TrendingUp}
                variant={profit >= 0 ? "success" : "warning"}
              />
            )}
            <StatCard
              label={isIndependentTutor ? "ÐÑÑÐºÑÑ Ð¾Ð¿Ð»Ð°ÑÐ¸" : "ÐÑÑÐºÑÑ (Ð¾ÑÑÐ¸Ð¼Ð°ÑÐ¸/Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸ÑÐ¸)"}
              value={isIndependentTutor ? `${pendingIncome} â´` : `${pendingIncome} / ${pendingExpense} â´`}
              icon={DollarSign}
              variant="warning"
            />
            {!isIndependentTutor && (
              <div className="col-span-2 rounded-xl border border-border bg-card p-3 lg:col-span-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      Ð¡ÐµÑÐµÐ´Ð½Ñ Ð½Ð°ÑÑÐ½ÐºÐ° ÑÐ°Ð±Ñ
                    </p>
                    <p
                      className={`mt-1 truncate font-display text-lg font-bold sm:text-xl ${
                        hubMarkup === null
                          ? "text-muted-foreground"
                          : hubMarkup >= 0
                          ? "text-success"
                          : "text-destructive"
                      }`}
                    >
                      {hubMarkup === null ? "â" : `${hubMarkup.toFixed(1)}%`}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      (Ð½Ð°Ð´ÑÐ¾Ð´Ð¶ÐµÐ½Ð½Ñ â Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸) / Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸
                    </p>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Percent className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* === Main: Payments table (priority for daily use) === */}
          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
            {visibleRows.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={DollarSign}
                  title="ÐÐµÐ¼Ð°Ñ Ð¿Ð»Ð°ÑÐµÐ¶ÑÐ² Ð·Ð° ÑÑÐ»ÑÑÑÐ°Ð¼Ð¸"
                  description="Ð¡Ð¿ÑÐ¾Ð±ÑÐ¹ÑÐµ Ð·Ð¼ÑÐ½Ð¸ÑÐ¸ Ð¼ÑÑÑÑÑ, ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ° Ð°Ð±Ð¾ ÑÐºÐ¸Ð½ÑÑÐµ ÑÑÐ»ÑÑÑÐ¸. ÐÐ°Ð²ÐµÑÑÐµÐ½Ñ ÑÑÐ¾ÐºÐ¸ Ð·'ÑÐ²Ð»ÑÑÑÑÑ ÑÑÑ Ð¾Ð´ÑÐ°Ð·Ñ."
                />
              </div>
            ) : (
              <>
                {/* Mobile cards (< lg) */}
                <div className="divide-y divide-border lg:hidden">
                  {visibleRows.map((l) => {
                    const profit = Number(l.student_price) - Number(l.tutor_payout);
                    return (
                      <div
                        key={l.id}
                        className="p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {l.subject}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(l.starts_at)}
                            </p>
                          </div>
                          {!isIndependentTutor && (
                            <div
                              className={`text-right shrink-0 text-sm font-semibold ${
                                profit >= 0 ? "text-foreground" : "text-destructive"
                              }`}
                            >
                              {profit} â´
                            </div>
                          )}
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-2 text-xs">
                          <div className="flex items-center justify-between gap-2 rounded-md bg-success/5 px-2.5 py-1.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-foreground">
                                {nameOf(l.student_id)}
                              </p>
                              {l.student_paid_at && (
                                <p className="truncate text-[11px] text-muted-foreground">
                                  Ð¾Ð¿Ð».: {formatDate(l.student_paid_at)}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold text-success">
                                +{l.student_price} â´
                              </span>
                              <button
                                onClick={() => togglePayment(l, "student_payment_status")}
                                aria-label="ÐÐ¼ÑÐ½Ð¸ÑÐ¸ ÑÑÐ°ÑÑÑ Ð¾Ð¿Ð»Ð°ÑÐ¸ ÑÑÐ½Ñ"
                              >
                                <Badge
                                  className={
                                    l.student_payment_status === "paid"
                                      ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[10px]"
                                      : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[10px]"
                                  }
                                >
                                  {l.student_payment_status === "paid" ? "ÐÐ¿Ð»Ð°ÑÐµÐ½Ð¾" : "ÐÑÑÐºÑÑ"}
                                </Badge>
                              </button>
                            </div>
                          </div>

                          {!isIndependentTutor && (
                            <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/5 px-2.5 py-1.5">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-foreground">
                                  {nameOf(l.tutor_id)}
                                </p>
                                {l.tutor_paid_at && (
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    Ð²Ð¸Ð¿.: {formatDate(l.tutor_paid_at)}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold text-destructive">
                                  -{l.tutor_payout} â´
                                </span>
                                <button
                                  onClick={() => togglePayment(l, "tutor_payout_status")}
                                  aria-label="ÐÐ¼ÑÐ½Ð¸ÑÐ¸ ÑÑÐ°ÑÑÑ Ð²Ð¸Ð¿Ð»Ð°ÑÐ¸"
                                >
                                  <Badge
                                    className={
                                      l.tutor_payout_status === "paid"
                                        ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[10px]"
                                        : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[10px]"
                                    }
                                  >
                                    {l.tutor_payout_status === "paid" ? "ÐÐ¸Ð¿Ð»Ð°ÑÐµÐ½Ð¾" : "ÐÑÑÐºÑÑ"}
                                  </Badge>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table (>= lg) */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/50">
                        <th className="px-3 py-3 w-10">
                          <Checkbox
                            checked={allSelected ? true : someSelected ? "indeterminate" : false}
                            onCheckedChange={toggleAll}
                            aria-label="ÐÐ±ÑÐ°ÑÐ¸ Ð²ÑÐµ"
                          />
                        </th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">ÐÐ°ÑÐ°</th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">Ð£ÑÐ¾Ðº</th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">Ð£ÑÐµÐ½Ñ</th>
                        <th className="px-3 py-3 text-right font-medium text-success">ÐÐ°Ð´ÑÐ¾Ð´Ð¶ÐµÐ½Ð½Ñ</th>
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-left font-medium text-muted-foreground">Ð ÐµÐ¿ÐµÑÐ¸ÑÐ¾Ñ</th>
                        )}
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-right font-medium text-destructive">ÐÐ¸Ð¿Ð»Ð°ÑÐ°</th>
                        )}
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-right font-medium text-muted-foreground">ÐÑÐ¸Ð±ÑÑÐ¾Ðº</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((l) => {
                        const profit = Number(l.student_price) - Number(l.tutor_payout);
                        const isSelected = selected.has(l.id);
                        return (
                          <tr
                            key={l.id}
                            className={`border-b border-border last:border-0 ${
                              isSelected ? "bg-primary/5" : ""
                            }`}
                          >
                            <td className="px-3 py-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRow(l.id)}
                                aria-label="ÐÐ±ÑÐ°ÑÐ¸ ÑÑÐ´Ð¾Ðº"
                              />
                            </td>
                            <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                              {formatDate(l.starts_at)}
                            </td>
                            <td className="px-3 py-3 text-foreground">{l.subject}</td>
                            <td className="px-3 py-3">
                              <div className="font-medium text-foreground">{nameOf(l.student_id)}</div>
                              {l.student_paid_at && (
                                <div className="text-xs text-muted-foreground">
                                  Ð¾Ð¿Ð».: {formatDate(l.student_paid_at)}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="font-semibold text-success">+{l.student_price} â´</div>
                              <button
                                onClick={() => togglePayment(l, "student_payment_status")}
                                className="mt-1 inline-block"
                              >
                                <Badge
                                  className={
                                    l.student_payment_status === "paid"
                                      ? "bg-success/10 text-success border-0 hover:bg-success/20 cursor-pointer"
                                      : "bg-warning/10 text-warning border-0 hover:bg-warning/20 cursor-pointer"
                                  }
                                >
                                  {l.student_payment_status === "paid" ? "ÐÐ¿Ð»Ð°ÑÐµÐ½Ð¾" : "ÐÑÑÐºÑÑ"}
                                </Badge>
                              </button>
                            </td>
                            {!isIndependentTutor && (
                              <td className="px-3 py-3">
                                <div className="font-medium text-foreground">{nameOf(l.tutor_id)}</div>
                                {l.tutor_paid_at && (
                                  <div className="text-xs text-muted-foreground">
                                    Ð²Ð¸Ð¿.: {formatDate(l.tutor_paid_at)}
                                  </div>
                                )}
                              </td>
                            )}
                            {!isIndependentTutor && (
                              <td className="px-3 py-3 text-right">
                                <div className="font-semibold text-destructive">-{l.tutor_payout} â´</div>
                                <button
                                  onClick={() => togglePayment(l, "tutor_payout_status")}
                                  className="mt-1 inline-block"
                                >
                                  <Badge
                                    className={
                                      l.tutor_payout_status === "paid"
                                        ? "bg-success/10 text-success border-0 hover:bg-success/20 cursor-pointer"
                                        : "bg-warning/10 text-warning border-0 hover:bg-warning/20 cursor-pointer"
                                    }
                                  >
                                    {l.tutor_payout_status === "paid" ? "ÐÐ¸Ð¿Ð»Ð°ÑÐµÐ½Ð¾" : "ÐÑÑÐºÑÑ"}
                                  </Badge>
                                </button>
                              </td>
                            )}
                            {!isIndependentTutor && (
                              <td
                                className={`px-3 py-3 text-right font-semibold ${
                                  profit >= 0 ? "text-foreground" : "text-destructive"
                                }`}
                              >
                                {profit} â´
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* === Bulk actions â secondary, after table === */}
          <details className="mt-4 hidden rounded-xl border border-border bg-card lg:block">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  ÐÐ°ÑÐ¾Ð²Ñ Ð´ÑÑ {selected.size > 0 && (
                    <span className="ml-1 font-semibold text-foreground">({selected.size})</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">ÑÐ¾Ð·Ð³Ð¾ÑÐ½ÑÑÐ¸</span>
              </div>
            </summary>
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => bulkMark("student_payment_status")}
              >
                <CheckCheck className="h-4 w-4" />
                Ð£ÑÐ½Ñ Ð¾Ð¿Ð»Ð°ÑÐ¸Ð»Ð¸
              </Button>
              {!isIndependentTutor && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selected.size === 0 || bulkBusy}
                  onClick={() => bulkMark("tutor_payout_status")}
                >
                  <CheckCheck className="h-4 w-4" />
                  ÐÐ¸Ð¿Ð»Ð°ÑÐµÐ½Ð¾ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°Ð¼
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4" />
                ÐÐºÑÐ¿Ð¾ÑÑ CSV
              </Button>
            </div>
          </details>

          {/* === Markup table â analytics, secondary === */}
          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Ð¡ÐµÑÐµÐ´Ð½Ñ Ð½Ð°ÑÑÐ½ÐºÐ° Ð¿Ð¾ ÑÐµÐ¿ÐµÑÐ¸ÑÐ¾ÑÐ°Ñ
                </h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  (ÑÑÐ½Ð° ÑÑÐ½Ñ â Ð²Ð¸Ð¿Ð»Ð°ÑÐ°) / Ð²Ð¸Ð¿Ð»Ð°ÑÐ°
                </span>
              </div>
              {markupByTutor.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  ÐÐµÐ¼Ð°Ñ Ð´Ð°Ð½Ð¸Ñ: Ð´Ð»Ñ ÑÐ¾Ð·ÑÐ°ÑÑÐ½ÐºÑ Ð¿Ð¾ÑÑÑÐ±Ð½Ñ Ð·Ð°Ð²ÐµÑÑÐµÐ½Ñ ÑÑÐ¾ÐºÐ¸ Ð· Ð·Ð°Ð¿Ð¾Ð²Ð½ÐµÐ½Ð¸Ð¼Ð¸ ÑÑÐ½Ð¾Ñ ÑÑÐ½Ñ ÑÐ° Ð²Ð¸Ð¿Ð»Ð°ÑÐ¾Ñ.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-2 py-2 text-left font-medium">Ð ÐµÐ¿ÐµÑÐ¸ÑÐ¾Ñ</th>
                        <th className="px-2 py-2 text-right font-medium">Ð£ÑÐ¾ÐºÑÐ²</th>
                        <th className="px-2 py-2 text-right font-medium">ÐÐ°ÑÑÐ½ÐºÐ°</th>
                      </tr>
                    </thead>
                    <tbody>
                      {markupByTutor.map((row) => (
                        <tr key={row.tutorId} className="border-b border-border last:border-0">
                          <td className="px-2 py-2 text-foreground">{row.name}</td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {row.lessonsCount}
                          </td>
                          <td
                            className={`px-2 py-2 text-right font-semibold ${
                              (row.markup ?? 0) >= 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {row.markup === null ? "â" : `${row.markup.toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* === Chart â moved to the bottom === */}
          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Ð¢Ð¸Ð¶Ð½ÐµÐ²Ð° Ð´Ð¸Ð½Ð°Ð¼ÑÐºÐ° Ð¿ÑÐ¸Ð±ÑÑÐºÑ (12 ÑÐ¸Ð¶Ð½ÑÐ²)
                </h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">ÐÐ°Ð²ÐµÑÑÐµÐ½Ñ ÑÑÐ¾ÐºÐ¸</span>
              </div>
              <FinanceWeeklyChart
                tutorNames={Object.fromEntries(
                  Object.values(profiles).map((p) => [
                    p.id,
                    `${p.first_name} ${p.last_name}`.trim() || "ÐÐµÐ· ÑÐ¼ÐµÐ½Ñ",
                  ])
                )}
                lessons={filtered.map((l) => ({
                  starts_at: l.starts_at,
                  status: l.status,
                  tutor_id: l.tutor_id,
                  student_price: Number(l.student_price),
                  tutor_payout: Number(l.tutor_payout),
                  student_payment_status: l.student_payment_status,
                  tutor_payout_status: l.tutor_payout_status,
                }))}
              />
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}

