import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  Plus,
  Wallet,
  ArrowRight,
  Package,
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
import { RecordPaymentSheet, PairOption } from "@/components/RecordPaymentSheet";
import { WalletDialog } from "@/components/WalletDialog";

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

interface WalletTx {
  id: string;
  tutor_id: string;
  student_id: string;
  kind: "topup" | "lesson_charge" | "refund" | "adjustment";
  lessons_delta: number;
  amount_delta: number;
  lesson_id: string | null;
  note: string | null;
  created_at: string;
}

interface WalletBalance {
  tutor_id: string;
  student_id: string;
  lessons_balance: number;
  amount_balance: number;
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
  const canManagePrepay = isManager || isIndependentTutor;

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([]);
  const [balances, setBalances] = useState<Record<string, WalletBalance>>({});
  const [pairRates, setPairRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [tutorFilter, setTutorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all|need_pay|need_payout|done
  const [kindFilter, setKindFilter] = useState<string>("all"); // all|lessons|prepay
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [walletPair, setWalletPair] = useState<PairOption | null>(null);

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
    if (lErr) toast.error("Помилка завантаження уроків");
    if (pErr) toast.error("Помилка завантаження профілів");
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
    setWalletTxs(((txData ?? []) as any[]) as WalletTx[]);
    const balMap: Record<string, WalletBalance> = {};
    ((balData ?? []) as any[]).forEach((b) => {
      balMap[`${b.tutor_id}:${b.student_id}`] = {
        tutor_id: b.tutor_id,
        student_id: b.student_id,
        lessons_balance: Number(b.lessons_balance ?? 0),
        amount_balance: Number(b.amount_balance ?? 0),
      };
    });
    setBalances(balMap);
    const rateMap: Record<string, number> = {};
    ((ratesData ?? []) as any[]).forEach((r) => {
      const key = `${r.tutor_id}:${r.student_id}`;
      const v = Number(r.price_per_lesson) || 0;
      if (v > (rateMap[key] ?? 0)) rateMap[key] = v;
    });
    setPairRates(rateMap);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const nameOf = (id: string) => {
    const p = profiles[id];
    if (!p) return "—";
    return `${p.first_name} ${p.last_name}`.trim() || "Без імені";
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

  // Pairs collected from lessons + wallet transactions (for RecordPaymentSheet picker)
  const pairsList = useMemo<PairOption[]>(() => {
    const map = new Map<string, PairOption>();
    const add = (tutor_id: string, student_id: string | null) => {
      if (!student_id) return;
      const key = `${tutor_id}:${student_id}`;
      if (map.has(key)) return;
      map.set(key, {
        tutor_id,
        student_id,
        tutor_name: nameOf(tutor_id),
        student_name: nameOf(student_id),
        rate: pairRates[key],
      });
    };
    lessons.forEach((l) => add(l.tutor_id, l.student_id));
    walletTxs.forEach((t) => add(t.tutor_id, t.student_id));
    return Array.from(map.values()).sort((a, b) =>
      a.student_name.localeCompare(b.student_name, "uk"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, walletTxs, profiles, pairRates]);

  const unpaidLessonsForSheet = useMemo(
    () =>
      lessons
        .filter(
          (l) =>
            l.status !== "cancelled" &&
            l.student_payment_status === "unpaid" &&
            l.student_id,
        )
        .map((l) => ({
          id: l.id,
          subject: l.subject,
          starts_at: l.starts_at,
          student_price: l.student_price,
          student_id: l.student_id,
          tutor_id: l.tutor_id,
        })),
    [lessons],
  );

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
  const nowMs = Date.now();
  const billable = filtered.filter((l) => {
    if (l.status === "cancelled" || l.status === "pending") return false;
    if (l.status === "completed") return true;
    const isPast = new Date(l.starts_at).getTime() < nowMs;
    const hasPayment =
      l.student_payment_status === "paid" || l.tutor_payout_status === "paid";
    return isPast || hasPayment;
  });

  const visibleLessons = useMemo(() => {
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

  // Wallet top-ups visible in the finance feed (apply same tutor/month filters; status filter doesn't apply)
  const visiblePrepays = useMemo(() => {
    return walletTxs
      .filter((t) => t.kind === "topup")
      .filter((t) => tutorFilter === "all" || t.tutor_id === tutorFilter)
      .filter((t) => monthFilter === "all" || monthKey(t.created_at) === monthFilter);
  }, [walletTxs, tutorFilter, monthFilter]);

  // Unified chronological feed
  type UnifiedRow =
    | { type: "lesson"; sort: number; l: LessonRow }
    | { type: "prepay"; sort: number; tx: WalletTx };

  const unifiedRows = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [];
    if (kindFilter !== "prepay") {
      visibleLessons.forEach((l) =>
        rows.push({ type: "lesson", sort: new Date(l.starts_at).getTime(), l }),
      );
    }
    if (kindFilter !== "lessons" && canManagePrepay) {
      visiblePrepays.forEach((tx) =>
        rows.push({ type: "prepay", sort: new Date(tx.created_at).getTime(), tx }),
      );
    }
    return rows.sort((a, b) => b.sort - a.sort);
  }, [visibleLessons, visiblePrepays, kindFilter, canManagePrepay]);

  // Keep visibleRows alias for backwards compatibility with existing code (lessons-only for bulk/CSV)
  const visibleRows = visibleLessons;

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
      toast.error("Не вдалося оновити статус");
      return;
    }
    toast.success(next === "paid" ? "Позначено як оплачено" : "Скинуто на неоплачено");
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
      toast.error("Не вдалося оновити записи");
      setLessons(previousLessons);
      return;
    }
    toast.success(`Оновлено ${ids.length} записів`);
    setSelected(new Set());
  };

  const exportCsv = () => {
    const header = [
      "Дата",
      "Предмет",
      "Учень",
      "Ціна учня (₴)",
      "Статус оплати учня",
      "Дата оплати учня",
      "Репетитор",
      "Виплата (₴)",
      "Статус виплати",
      "Дата виплати",
      "Прибуток (₴)",
    ];
    const rows = visibleRows.map((l) => [
      formatDate(l.starts_at),
      l.subject,
      nameOf(l.student_id),
      String(l.student_price),
      l.student_payment_status === "paid" ? "Оплачено" : "Очікує",
      l.student_paid_at ? formatDate(l.student_paid_at) : "",
      nameOf(l.tutor_id),
      String(l.tutor_payout),
      l.tutor_payout_status === "paid" ? "Виплачено" : "Очікує",
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
    toast.success("CSV завантажено");
  };

  const allSelected = selected.size === visibleRows.length && visibleRows.length > 0;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <AppLayout>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">Фінанси</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isIndependentTutor
              ? "Оплати від ваших учнів"
              : "Оплати від учнів та виплати репетиторам"}
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
              Зафіксувати оплату
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
                    <SelectValue placeholder="Репетитор" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Всі репетитори</SelectItem>
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
                  <SelectValue placeholder="Період" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всі періоди</SelectItem>
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
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всі статуси</SelectItem>
                  <SelectItem value="need_pay">Очікує оплати учня</SelectItem>
                  {!isIndependentTutor && (
                    <SelectItem value="need_payout">Очікує виплати</SelectItem>
                  )}
                  {!isIndependentTutor && (
                    <SelectItem value="done">Все закрито</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {canManagePrepay && (
              <div className="w-full sm:w-44">
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Тип" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Уроки + передоплати</SelectItem>
                    <SelectItem value="lessons">Лише уроки</SelectItem>
                    <SelectItem value="prepay">Лише передоплати</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </MobileFilters>
        </div>
      </div>


      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження...
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${isIndependentTutor ? "lg:grid-cols-2" : "lg:grid-cols-4 xl:grid-cols-5"}`}>
            <StatCard
              label={isIndependentTutor ? "Отримано" : "Надходження"}
              value={`${totalIncome} ₴`}
              icon={ArrowDownLeft}
              variant="success"
            />
            {!isIndependentTutor && (
              <StatCard label="Виплати" value={`${totalExpense} ₴`} icon={ArrowUpRight} />
            )}
            {!isIndependentTutor && (
              <StatCard
                label="Прибуток"
                value={`${profit} ₴`}
                icon={TrendingUp}
                variant={profit >= 0 ? "success" : "warning"}
              />
            )}
            <StatCard
              label={isIndependentTutor ? "Очікує оплати" : "Очікує (отримати/виплатити)"}
              value={isIndependentTutor ? `${pendingIncome} ₴` : `${pendingIncome} / ${pendingExpense} ₴`}
              icon={DollarSign}
              variant="warning"
            />
            {!isIndependentTutor && (
              <div className="col-span-2 rounded-xl border border-border bg-card p-3 lg:col-span-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      Середня націнка хабу
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
                      (надходження − виплати) / виплати
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
                  title="Немає платежів за фільтрами"
                  description="Спробуйте змінити місяць, репетитора або скиньте фільтри. Завершені уроки з'являться тут одразу."
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
                                  опл.: {formatDate(l.student_paid_at)}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold text-success">
                                +{l.student_price} ₴
                              </span>
                              <button
                                onClick={() => togglePayment(l, "student_payment_status")}
                                aria-label="Змінити статус оплати учня"
                              >
                                <Badge
                                  className={
                                    l.student_payment_status === "paid"
                                      ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[10px]"
                                      : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[10px]"
                                  }
                                >
                                  {l.student_payment_status === "paid" ? "Оплачено" : "Очікує"}
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
                                    вип.: {formatDate(l.tutor_paid_at)}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold text-destructive">
                                  -{l.tutor_payout} ₴
                                </span>
                                <button
                                  onClick={() => togglePayment(l, "tutor_payout_status")}
                                  aria-label="Змінити статус виплати"
                                >
                                  <Badge
                                    className={
                                      l.tutor_payout_status === "paid"
                                        ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[10px]"
                                        : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[10px]"
                                    }
                                  >
                                    {l.tutor_payout_status === "paid" ? "Виплачено" : "Очікує"}
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
                            aria-label="Обрати все"
                          />
                        </th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">Дата</th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">Урок</th>
                        <th className="px-3 py-3 text-left font-medium text-muted-foreground">Учень</th>
                        <th className="px-3 py-3 text-right font-medium text-success">Надходження</th>
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-left font-medium text-muted-foreground">Репетитор</th>
                        )}
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-right font-medium text-destructive">Виплата</th>
                        )}
                        {!isIndependentTutor && (
                          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Прибуток</th>
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
                                aria-label="Обрати рядок"
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
                                  опл.: {formatDate(l.student_paid_at)}
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
                                  {l.student_payment_status === "paid" ? "Оплачено" : "Очікує"}
                                </Badge>
                              </button>
                            </td>
                            {!isIndependentTutor && (
                              <td className="px-3 py-3">
                                <div className="font-medium text-foreground">{nameOf(l.tutor_id)}</div>
                                {l.tutor_paid_at && (
                                  <div className="text-xs text-muted-foreground">
                                    вип.: {formatDate(l.tutor_paid_at)}
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
                                    {l.tutor_payout_status === "paid" ? "Виплачено" : "Очікує"}
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
                  Масові дії {selected.size > 0 && (
                    <span className="ml-1 font-semibold text-foreground">({selected.size})</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">розгорнути</span>
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
                Учні оплатили
              </Button>
              {!isIndependentTutor && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selected.size === 0 || bulkBusy}
                  onClick={() => bulkMark("tutor_payout_status")}
                >
                  <CheckCheck className="h-4 w-4" />
                  Виплачено репетиторам
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4" />
                Експорт CSV
              </Button>
            </div>
          </details>

          {/* === Markup table — analytics, secondary === */}
          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Середня націнка по репетиторах
                </h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  (ціна учня − виплата) / виплата
                </span>
              </div>
              {markupByTutor.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Немає даних: для розрахунку потрібні завершені уроки з заповненими ціною учня та виплатою.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-2 py-2 text-left font-medium">Репетитор</th>
                        <th className="px-2 py-2 text-right font-medium">Уроків</th>
                        <th className="px-2 py-2 text-right font-medium">Націнка</th>
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
                  Тижнева динаміка прибутку (12 тижнів)
                </h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">Завершені уроки</span>
              </div>
              <FinanceWeeklyChart
                tutorNames={Object.fromEntries(
                  Object.values(profiles).map((p) => [
                    p.id,
                    `${p.first_name} ${p.last_name}`.trim() || "Без імені",
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

