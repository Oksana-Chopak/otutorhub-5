import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  AlertCircle,
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
import { FinancesSkeleton } from "@/components/PageSkeletons";
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
  const { t } = useTranslation();
  const { roles } = useAuth();
  const { isIndependent } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isIndependentTutor = isTutor && !isManager && isIndependent;

  const [searchParams, setSearchParams] = useSearchParams();

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [tutorFilter, setTutorFilter] = useState<string>("all");
  // Read initial filter from URL ?filter=need_pay|need_payout|done
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("filter") ?? "all"
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Sync statusFilter changes back to URL so the state is shareable/bookmarkable
  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    if (value === "all") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ filter: value }, { replace: true });
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const [
      { data: lessonsData, error: lErr },
      { data: profilesData, error: pErr },
      { data: txData },
      { data: balData },
      { data: ratesData },
    ] = await Promise.all([
      supabase
        .from("lessons")
        .select(
          "id, subject, starts_at, status, student_id, tutor_id, lesson_details!inner(student_price, tutor_payout, student_payment_status, tutor_payout_status, student_paid_at, tutor_paid_at)"
        )
        .order("starts_at", { ascending: false }),
      supabase.from("profiles").select("id, first_name, last_name"),
      supabase
        .from("student_wallet_transactions" as any)
        .select("id, tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("student_wallet_balances" as any)
        .select("tutor_id, student_id, lessons_balance, amount_balance"),
      supabase
        .from("student_rates")
        .select("tutor_id, student_id, price_per_lesson, archived_at")
        .is("archived_at", null),
    ]);
    if (lErr) toast.error(t("finances.loadLessonsError"));
    if (pErr) toast.error(t("finances.loadProfilesError"));
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
    if (!p) return "—";
    return `${p.first_name} ${p.last_name}`.trim() || t("common.noName");
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
    let rows: LessonRow[];
    switch (statusFilter) {
      case "need_pay":
        rows = billable.filter((l) => l.student_payment_status === "unpaid");
        break;
      case "need_payout":
        rows = billable.filter((l) => l.tutor_payout_status === "unpaid");
        break;
      case "done":
        rows = billable.filter(
          (l) =>
            l.student_payment_status === "paid" && l.tutor_payout_status === "paid"
        );
        break;
      default:
        // In "all" view: unpaid rows first (by date desc), then paid (by date desc)
        rows = [
          ...billable
            .filter(
              (l) =>
                l.student_payment_status === "unpaid" ||
                l.tutor_payout_status === "unpaid"
            )
            .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
          ...billable
            .filter(
              (l) =>
                l.student_payment_status === "paid" &&
                l.tutor_payout_status === "paid"
            )
            .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
        ];
        break;
    }
    return rows;
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

  // Markup % ("маржа" як націнка): (income - payout) / payout * 100
  // Рахуємо тільки по уроках, де відомі обидві суми (price > 0 і payout > 0),
  // інакше націнка не визначена.
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
      .filter((r) => r.margin !== null)
      .sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable, profiles]);

  // Last-4-weeks profit sparkline series
  const profitSparkline = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayIdx = (today.getDay() + 6) % 7; // 0 = Mon
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - dayIdx);
    const buckets: { key: string; start: Date; profit: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const s = new Date(thisWeekStart);
      s.setDate(thisWeekStart.getDate() - i * 7);
      buckets.push({ key: s.toISOString().slice(0, 10), start: s, profit: 0 });
    }
    const firstStart = buckets[0].start.getTime();
    billable.forEach((l) => {
      const t = new Date(l.starts_at).getTime();
      if (t < firstStart) return;
      const idx = Math.floor((t - firstStart) / (7 * 24 * 3600 * 1000));
      if (idx < 0 || idx >= buckets.length) return;
      const income = l.student_payment_status === "paid" ? Number(l.student_price) : 0;
      const expense = l.tutor_payout_status === "paid" ? Number(l.tutor_payout) : 0;
      buckets[idx].profit += income - expense;
    });
    return buckets.map((b) => ({ week: b.key, profit: b.profit }));
  }, [billable]);

  // Income contribution per student (paid lessons only) — for pie chart
  const incomeByStudent = useMemo(() => {
    const map = new Map<string, number>();
    billable
      .filter((l) => l.student_payment_status === "paid" && Number(l.student_price) > 0)
      .forEach((l) => {
        map.set(l.student_id, (map.get(l.student_id) ?? 0) + Number(l.student_price));
      });
    const rows = Array.from(map.entries())
      .map(([student_id, amount]) => ({ student_id, name: nameOf(student_id), amount }))
      .sort((a, b) => b.amount - a.amount);
    // Collapse long tail into "Інші" (keep top 6)
    const TOP = 6;
    if (rows.length <= TOP) return rows;
    const head = rows.slice(0, TOP);
    const tail = rows.slice(TOP);
    const other = tail.reduce((s, r) => s + r.amount, 0);
    return [...head, { student_id: "__other__", name: t("finances.others", { count: tail.length }), amount: other }];
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

    // Optimistic update — no full page reload, no jump.
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
      toast.error(t("finances.updateStatusFailed"));
      return;
    }
    if (next === "paid") {
      const revert = async () => {
        // Restore prior state in DB + UI
        setLessons((prev) =>
          prev.map((l) =>
            l.id === lesson.id
              ? { ...l, [field]: lesson[field], [paidAtField]: field === "student_payment_status" ? lesson.student_paid_at : lesson.tutor_paid_at } as LessonRow
              : l
          )
        );
        const revertPayload =
          field === "student_payment_status"
            ? { student_payment_status: lesson.student_payment_status }
            : { tutor_payout_status: lesson.tutor_payout_status };
        await supabase.from("lesson_details").update(revertPayload).eq("lesson_id", lesson.id);
      };
      toast.success(
        field === "student_payment_status" ? t("finances.markedAsPaid") : t("finances.markedAsPayout"),
        {
          duration: 5000,
          action: { label: t("finances.undoAction"), onClick: () => { void revert(); } },
        },
      );
    } else {
      toast.success(t("finances.resetToUnpaid"));
    }
  };

  // Used by RecordPaymentSheet: only marks as paid (no toggle).
  const markLessonPaidById = async (lessonId: string) => {
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) return;
    if (lesson.student_payment_status === "paid") return;
    await togglePayment(lesson, "student_payment_status");
  };

  const openWalletForPair = (tutor_id: string, student_id: string) => {
    setWalletPair({
      tutor_id,
      student_id,
      tutor_name: nameOf(tutor_id),
      student_name: nameOf(student_id),
      rate: pairRates[`${tutor_id}:${student_id}`],
    });
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
      toast.error(t("finances.bulkUpdateFailed"));
      setLessons(previousLessons);
      return;
    }
    toast.success(t("finances.bulkUpdated", { count: ids.length }));
    setSelected(new Set());
  };

  const exportCsv = () => {
    const header = [
      t("finances.csvDate"),
      t("finances.csvSubject"),
      t("finances.csvStudent"),
      t("finances.csvStudentPrice"),
      t("finances.csvStudentPayStatus"),
      t("finances.csvStudentPaidAt"),
      t("finances.csvTutor"),
      t("finances.csvPayout"),
      t("finances.csvPayoutStatus"),
      t("finances.csvPayoutAt"),
      t("finances.csvProfit"),
    ];
    const rows = visibleRows.map((l) => [
      formatDate(l.starts_at),
      l.subject,
      nameOf(l.student_id),
      String(l.student_price),
      l.student_payment_status === "paid" ? t("finances.csvPaid") : t("finances.csvPending"),
      l.student_paid_at ? formatDate(l.student_paid_at) : "",
      nameOf(l.tutor_id),
      String(l.tutor_payout),
      l.tutor_payout_status === "paid" ? t("finances.csvPaidOut") : t("finances.csvPending"),
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
    toast.success(t("finances.csvDownloaded"));
  };

  const allSelected = selected.size === visibleRows.length && visibleRows.length > 0;
  const someSelected = selected.size > 0 && !allSelected;

  // Inline wallet balance pill for a (tutor, student) pair
  const renderWalletBadge = (tutor_id: string, student_id: string) => {
    const b = balances[`${tutor_id}:${student_id}`];
    if (!b) return null;
    const lessons = Number(b.lessons_balance ?? 0);
    const amount = Number(b.amount_balance ?? 0);
    const isNegative = lessons < 0 || amount < 0;
    const hasPositive = lessons > 0 || amount > 0;
    if (!isNegative && !hasPositive) return null;
    const label = isNegative
      ? `${lessons < 0 ? `${lessons} ур.` : ""}${lessons < 0 && amount < 0 ? " / " : ""}${amount < 0 ? `${amount.toFixed(0)} ₴` : ""}`
      : `${lessons > 0 ? `${lessons} ур.` : ""}${lessons > 0 && amount > 0 ? " / " : ""}${amount > 0 ? `${amount.toFixed(0)} ₴` : ""}`;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openWalletForPair(tutor_id, student_id);
        }}
        title={isNegative ? t("finances.walletNegative") : t("finances.walletPositive")}
        className={`ml-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium align-middle ${
          isNegative
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
            : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
        }`}
      >
        {isNegative ? (
          <AlertTriangle className="h-2.5 w-2.5" />
        ) : (
          <Wallet className="h-2.5 w-2.5" />
        )}
        {label}
      </button>
    );
  };

  const desktopColCount = 5 + (isIndependentTutor ? 0 : 3);

  return (
    <AppLayout>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">{t("finances.title")}</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isIndependentTutor
              ? t("finances.pageSubtitleTutor")
              : t("finances.pageSubtitleManager")}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {canManagePrepay && (
            <Button
              size="sm"
              onClick={() => setRecordOpen(true)}
              className="h-9 w-full sm:w-auto"
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("finances.recordPayment")}
            </Button>
          )}
          <MobileFilters
            activeCount={
              (monthFilter !== "all" ? 1 : 0) +
              (tutorFilter !== "all" ? 1 : 0) +
              (statusFilter !== "all" ? 1 : 0) +
              (kindFilter !== "all" ? 1 : 0)
            }
            className="w-full sm:w-auto"
          >
            {!isIndependentTutor && (
              <div className="w-full sm:w-44">
                <Select value={tutorFilter} onValueChange={setTutorFilter}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={t("finances.allTutors")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("finances.allTutors")}</SelectItem>
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
              <Select value={tutorFilter} onValueChange={setTutorFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("finances.allPeriods")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("finances.allPeriods")}</SelectItem>
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
                  <SelectValue placeholder={t("finances.allStatuses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("finances.allStatuses")}</SelectItem>
                  <SelectItem value="need_pay">{t("finances.needStudentPay")}</SelectItem>
                  {!isIndependentTutor && (
                    <SelectItem value="need_payout">{t("finances.needPayout")}</SelectItem>
                  )}
                  {!isIndependentTutor && (
                    <SelectItem value="done">{t("finances.allClosed")}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {canManagePrepay && (
              <div className="w-full sm:w-44">
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={t("finances.kindAll")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("finances.kindAll")}</SelectItem>
                    <SelectItem value="lessons">{t("finances.kindLessons")}</SelectItem>
                    <SelectItem value="prepay">{t("finances.kindPrepay")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </MobileFilters>
        </div>
          </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <>
          {/* Context banner — shown when arriving from dashboard with a filter pre-set */}
          {statusFilter !== "all" && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
              <span className="flex-1 text-foreground">
                {statusFilter === "need_pay" && (
                  <>Показано уроки, <strong>де учень ще не оплатив</strong>. Натисніть на статус щоб позначити оплату.</>
                )}
                {statusFilter === "need_payout" && (
                  <>Показано уроки, <strong>де репетитор ще не отримав виплату</strong>. Натисніть на статус щоб позначити виплату.</>
                )}
              </span>
              <button
                className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => handleStatusFilterChange("all")}
              >
                Показати всі
              </button>
            </div>
          )}
          <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${isIndependentTutor ? "lg:grid-cols-2" : "lg:grid-cols-4 xl:grid-cols-5"}`}>
            <StatCard
              label={isIndependentTutor ? t("finances.received") : t("finances.incoming")}
              value={`${totalIncome} ₴`}
              icon={ArrowDownLeft}
              variant="success"
            />
            {!isIndependentTutor && (
              <StatCard label={t("finances.payouts")} value={`${totalExpense} ₴`} icon={ArrowUpRight} />
            )}
            {!isIndependentTutor && (
              <StatCard
                label={t("finances.profit")}
                value={`${profit} ₴`}
                icon={TrendingUp}
                variant={profit >= 0 ? "success" : "warning"}
              />
            )}
            <StatCard
              label={isIndependentTutor ? t("finances.awaitingPay") : t("finances.awaitingPayOrPayout")}
              value={isIndependentTutor ? `${pendingIncome} ₴` : `${pendingIncome} / ${pendingExpense} ₴`}
              icon={DollarSign}
              variant="warning"
            />
            {!isIndependentTutor && (
              <div className="col-span-2 rounded-xl border border-border bg-card p-3 lg:col-span-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      {t("finances.margin")}
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
                      {hubMarkup === null ? "—" : `${hubMarkup.toFixed(1)}%`}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("finances.marginDesc")}
                    </p>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Percent className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* === Mini-trends row: profit sparkline + income contribution pie === */}
          {!isIndependentTutor && (
            <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("finances.profitTrend")}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {`${profitSparkline.reduce((s, b) => s + b.profit, 0)} ₴`}
                  </span>
                </div>
                <ProfitSparkline data={profitSparkline} />
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("finances.incomeByStudent")}
                  </h2>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {t("finances.paidOnly")}
                  </span>
                </div>
                <IncomeByStudentPie data={incomeByStudent} />
              </div>
            </div>
          )}

          {/* === Main: Payments table (priority for daily use) === */}
          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
            {visibleRows.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={DollarSign}
                  title={t("finances.noPaymentsFiltered")}
                  description={t("finances.noPaymentsDesc")}
                />
              </div>
            ) : (
              <>
                {/* Mobile cards (< lg) */}
                <div className="divide-y divide-border lg:hidden">
                  {unifiedRows.map((row) => {
                    if (row.type === "prepay") {
                      const tx = row.tx;
                      return (
                        <button
                          key={`p-${tx.id}`}
                          type="button"
                          onClick={() => openWalletForPair(tx.tutor_id, tx.student_id)}
                          className="block w-full p-3 text-left hover:bg-primary/5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 truncate text-sm font-medium text-primary">
                                <Package className="h-3.5 w-3.5" /> {t("finances.prepayLabel")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(tx.created_at)} · {nameOf(tx.student_id)} ↔ {nameOf(tx.tutor_id)}
                              </p>
                              {tx.note && (
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{tx.note}</p>
                              )}
                            </div>
                            <div className="shrink-0 text-right text-sm font-semibold text-primary tabular-nums">
                              {tx.lessons_delta > 0 && <div>+{tx.lessons_delta} ур.</div>}
                              {Number(tx.amount_delta) > 0 && <div>+{Number(tx.amount_delta).toFixed(0)} ₴</div>}
                            </div>
                          </div>
                        </button>
                      );
                    }
                    const l = row.l;
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
                              {profit} ₴
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
                                  {t("finances.paidDate")} {formatDate(l.student_paid_at)}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold text-success">
                                +{l.student_price} ₴
                              </span>
                              <button
                                onClick={() => togglePayment(l, "student_payment_status")}
                                aria-label={t("finances.statusPaid")}
                              >
                                <Badge
                                  className={
                                    l.student_payment_status === "paid"
                                      ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[10px]"
                                      : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[10px]"
                                  }
                                >
                                  {l.student_payment_status === "paid" ? t("finances.statusPaid") : t("finances.statusPending")}
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
                                    {t("finances.payoutDate")} {formatDate(l.tutor_paid_at)}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold text-destructive">
                                  -{l.tutor_payout} ₴
                                </span>
                                <button
                                  onClick={() => togglePayment(l, "tutor_payout_status")}
                                  aria-label={t("finances.statusPaidOut")}
                                >
                                  <Badge
                                    className={
                                      l.tutor_payout_status === "paid"
                                        ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[10px]"
                                        : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[10px]"
                                    }
                                  >
                                    {l.tutor_payout_status === "paid" ? t("finances.statusPaidOut") : t("finances.statusPending")}
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
                            aria-label={t("finances.selectAll")}
                          />
                        </th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colDate")}</th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colLesson")}</th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colStudent")}</th>
                        <th className="px-3 py-3 text-right font-medium text-success">{t("finances.colIncome")}</th>
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colTutor")}</th>
                        )}
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-right font-medium text-destructive">{t("finances.colPayout")}</th>
                        )}
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-right font-medium text-muted-foreground">{t("finances.colProfit")}</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {unifiedRows.map((row) => {
                        if (row.type === "prepay") {
                          const tx = row.tx;
                          return (
                            <tr
                              key={`p-${tx.id}`}
                              className="border-b border-border last:border-0 bg-primary/[0.04] hover:bg-primary/10 cursor-pointer"
                              onClick={() => openWalletForPair(tx.tutor_id, tx.student_id)}
                            >
                              <td className="px-3 py-3" />
                              <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                                {formatDate(tx.created_at)}
                              </td>
                              <td className="px-3 py-3" colSpan={desktopColCount - 3}>
                                <div className="flex items-center gap-2 text-primary">
                                  <Package className="h-4 w-4 shrink-0" />
                                  <span className="font-medium">{t("finances.prepayLabel")}</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-foreground truncate">
                                    {nameOf(tx.student_id)} ↔ {nameOf(tx.tutor_id)}
                                  </span>
                                  {tx.note && (
                                    <span className="truncate text-xs text-muted-foreground">
                                      — {tx.note}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right font-semibold text-primary tabular-nums whitespace-nowrap">
                                {tx.lessons_delta > 0 && <div>+{tx.lessons_delta} ур.</div>}
                                {Number(tx.amount_delta) > 0 && (
                                  <div>+{Number(tx.amount_delta).toFixed(0)} ₴</div>
                                )}
                              </td>
                            </tr>
                          );
                        }
                        const l = row.l;
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
                                aria-label={t("finances.selectRow")}
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
                                  {t("finances.paidDate")} {formatDate(l.student_paid_at)}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="font-semibold text-success">+{l.student_price} ₴</div>
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
                                  {l.student_payment_status === "paid" ? t("finances.statusPaid") : t("finances.statusPending")}
                                </Badge>
                              </button>
                            </td>
                            {!isIndependentTutor && (
                              <td className="px-3 py-3">
                                <div className="font-medium text-foreground">{nameOf(l.tutor_id)}</div>
                                {l.tutor_paid_at && (
                                  <div className="text-xs text-muted-foreground">
                                    {t("finances.payoutDate")} {formatDate(l.tutor_paid_at)}
                                  </div>
                                )}
                              </td>
                            )}
                            {!isIndependentTutor && (
                              <td className="px-3 py-3 text-right">
                                <div className="font-semibold text-destructive">-{l.tutor_payout} ₴</div>
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
                                    {l.tutor_payout_status === "paid" ? t("finances.statusPaidOut") : t("finances.statusPending")}
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
                                {profit} ₴
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

          {/* === Bulk actions — secondary, after table === */}
          <details className="mt-4 hidden rounded-xl border border-border bg-card lg:block">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("finances.bulkActions")} {selected.size > 0 && (
                    <span className="ml-1 font-semibold text-foreground">({selected.size})</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{t("finances.expandBulk")}</span>
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
                {t("finances.markStudentsPaid")}
              </Button>
              {!isIndependentTutor && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selected.size === 0 || bulkBusy}
                  onClick={() => bulkMark("tutor_payout_status")}
                >
                  <CheckCheck className="h-4 w-4" />
                  {t("finances.markTutorsPaid")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4" />
                {t("finances.exportCsv")}
              </Button>
            </div>
          </details>

          {/* === Markup table — analytics, secondary === */}
          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("finances.marginByTutor")}
                </h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {t("finances.marginFormula")}
                </span>
              </div>
              {markupByTutor.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("finances.noMarginData")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-2 py-2 text-left font-medium">{t("finances.colTutor")}</th>
                        <th className="px-2 py-2 text-right font-medium">{t("finances.colLessonsCount")}</th>
                        <th className="px-2 py-2 text-right font-medium">{t("finances.colMargin")}</th>
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
                            {row.markup === null ? "—" : `${row.markup.toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* === Chart — moved to the bottom === */}
          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("finances.weeklyTrend")}
                </h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">{t("finances.completedOnly")}</span>
              </div>
              <FinanceWeeklyChart
                tutorNames={Object.fromEntries(
                  Object.values(profiles).map((p) => [
                    p.id,
                    `${p.first_name} ${p.last_name}`.trim() || t("common.noName"),
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

      {canManagePrepay && (
        <div className="mt-4 flex justify-end">
          <Button asChild variant="ghost" size="sm">
            <Link to="/wallets">
              <Wallet className="mr-1 h-4 w-4" />
              {t("finances.allPrepays")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}

      {canManagePrepay && (
        <RecordPaymentSheet
          open={recordOpen}
          onOpenChange={setRecordOpen}
          pairs={pairsList}
          unpaidLessons={unpaidLessonsForSheet}
          onMarkLessonPaid={markLessonPaidById}
          onWalletTopUp={fetchData}
        />
      )}

      {walletPair && (
        <WalletDialog
          open={!!walletPair}
          onOpenChange={(o) => {
            if (!o) {
              setWalletPair(null);
              fetchData();
            }
          }}
          tutorId={walletPair.tutor_id}
          studentId={walletPair.student_id}
          tutorName={walletPair.tutor_name}
          studentName={walletPair.student_name}
          ratePerLesson={walletPair.rate}
          canTopUp={canManagePrepay}
          canDelete={isManager}
        />
      )}
    </AppLayout>
  );
}

