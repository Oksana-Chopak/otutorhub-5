import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  DollarSign,
  Loader2,
  Download,
  CheckCheck,
  AlertTriangle,
  ArrowRight,
  Package,
  Plus,
  Wallet,
  Percent,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { FinanceWeeklyChart } from "@/components/FinanceWeeklyChart";
import { FinancesSkeleton } from "@/components/PageSkeletons";
import { IncomeByStudentPie } from "@/components/IncomeByStudentPie";
import { ProfitSparkline } from "@/components/ProfitSparkline";
import { RecordPaymentSheet, type PairOption, type UnpaidLessonOption } from "@/components/RecordPaymentSheet";
import { WalletDialog } from "@/components/WalletDialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { cn } from "@/lib/utils";

type PaymentStatus = "paid" | "unpaid";
type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type Period = "week" | "month" | "all";
type TabKey = "income" | "expenses" | "debts";

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

interface WalletTransaction {
  id: string;
  tutor_id: string;
  student_id: string;
  kind: string;
  lessons_delta: number;
  amount_delta: number;
  lesson_id: string | null;
  note: string | null;
  created_at: string;
}

interface WalletPair extends PairOption {}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/** Start of current ISO week (Mon, local midnight). */
function startOfWeek(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function startOfMonth(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

/**
 * Map legacy `?filter=` param to the new tab model so old links keep working.
 */
function legacyFilterToTab(value: string | null): TabKey {
  if (value === "need_pay" || value === "need_payout") return "debts";
  if (value === "done") return "income";
  return "debts";
}

export default function FinancesPage() {
  const { t } = useTranslation();
  const { roles } = useAuth();
  const { isIndependent } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isIndependentTutor = isTutor && !isManager && isIndependent;
  const canManagePrepay = isManager || isIndependentTutor;

  const [searchParams, setSearchParams] = useSearchParams();

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [tutorFilter, setTutorFilter] = useState<string>("all");
  const [period, setPeriod] = useState<Period>("month");
  // Tab is sourced from URL (?tab=) with legacy ?filter= support so deep links keep working.
  const initialTab: TabKey = (searchParams.get("tab") as TabKey | null)
    ?? legacyFilterToTab(searchParams.get("filter"));
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [balances, setBalances] = useState<Record<string, { lessons_balance: number; amount_balance: number }>>({});
  const [pairRates, setPairRates] = useState<Record<string, number | undefined>>({});
  const [walletPair, setWalletPair] = useState<WalletPair | null>(null);

  // Sync tab to URL so the view is shareable/bookmarkable; clear legacy `filter`.
  const handleTabChange = (value: string) => {
    const next = value as TabKey;
    setActiveTab(next);
    setSelected(new Set());
    const params = new URLSearchParams(searchParams);
    params.delete("filter");
    params.set("tab", next);
    setSearchParams(params, { replace: true });
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
    setTransactions(((txData ?? []) as any[]).map((tx) => ({
      ...tx,
      lessons_delta: Number(tx.lessons_delta ?? 0),
      amount_delta: Number(tx.amount_delta ?? 0),
    })) as WalletTransaction[]);
    const balanceMap: Record<string, { lessons_balance: number; amount_balance: number }> = {};
    ((balData ?? []) as any[]).forEach((b) => {
      balanceMap[`${b.tutor_id}:${b.student_id}`] = {
        lessons_balance: Number(b.lessons_balance ?? 0),
        amount_balance: Number(b.amount_balance ?? 0),
      };
    });
    setBalances(balanceMap);
    const rateMap: Record<string, number | undefined> = {};
    ((ratesData ?? []) as any[]).forEach((r) => {
      rateMap[`${r.tutor_id}:${r.student_id}`] = Number(r.price_per_lesson ?? 0) || undefined;
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
    return `${p.first_name} ${p.last_name}`.trim() || t("common.noName");
  };

  const tutorOptions = useMemo(() => {
    const ids = Array.from(new Set(lessons.map((l) => l.tutor_id)));
    return ids
      .map((id) => ({ id, name: nameOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, profiles]);

  // Tutor scope applies everywhere (analytics + tab content).
  const tutorScoped = useMemo(
    () => lessons.filter((l) => tutorFilter === "all" || l.tutor_id === tutorFilter),
    [lessons, tutorFilter],
  );

  // Billable = lesson actually counts toward money flow.
  // Includes: completed lessons, past lessons (date already passed), or any lesson
  // that has a payment marked (e.g. independent tutor pre-paid scheduled lesson).
  // Excludes: cancelled, and pending requests that never happened.
  const billable = useMemo(() => {
    const nowMs = Date.now();
    return tutorScoped.filter((l) => {
      if (l.status === "cancelled" || l.status === "pending") return false;
      if (l.status === "completed") return true;
      const isPast = new Date(l.starts_at).getTime() < nowMs;
      const hasPayment =
        l.student_payment_status === "paid" || l.tutor_payout_status === "paid";
      return isPast || hasPayment;
    });
  }, [tutorScoped]);

  // Period scope drives the sticky summary card and tab content.
  const periodStart = useMemo(() => {
    if (period === "week") return startOfWeek().getTime();
    if (period === "month") return startOfMonth().getTime();
    return 0;
  }, [period]);

  const inPeriod = (iso: string) => new Date(iso).getTime() >= periodStart;

  const periodBillable = useMemo(
    () => billable.filter((l) => inPeriod(l.starts_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [billable, periodStart],
  );

  const periodTopups = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          (tx.kind === "topup" || tx.lessons_delta > 0 || Number(tx.amount_delta) > 0)
          && (tutorFilter === "all" || tx.tutor_id === tutorFilter)
          && inPeriod(tx.created_at),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, tutorFilter, periodStart],
  );

  // Per-tab row sets — keep the same shape used by both mobile cards and desktop table.
  type Row =
    | { type: "lesson"; l: LessonRow }
    | { type: "prepay"; tx: WalletTransaction };

  // Smart sort:
  //   1) unpaid (student or tutor) — nearest to today first (overdue first, then future)
  //   2) past paid — newest first
  //   3) future paid — soonest first
  // Prepays always go to bucket 2 (paid income, sorted by created_at desc).
  const nowTs = Date.now();
  const lessonBucket = (l: LessonRow): number => {
    const anyUnpaid =
      l.student_payment_status === "unpaid" ||
      (!isIndependentTutor && l.tutor_payout_status === "unpaid");
    if (anyUnpaid) return 1;
    const ts = new Date(l.starts_at).getTime();
    return ts <= nowTs ? 2 : 3;
  };

  const smartSort = (a: Row, b: Row) => {
    const aBucket = a.type === "lesson" ? lessonBucket(a.l) : 2;
    const bBucket = b.type === "lesson" ? lessonBucket(b.l) : 2;
    if (aBucket !== bBucket) return aBucket - bBucket;
    const ad = a.type === "lesson" ? a.l.starts_at : a.tx.created_at;
    const bd = b.type === "lesson" ? b.l.starts_at : b.tx.created_at;
    if (aBucket === 1) {
      // Closest to today first (abs distance)
      const aDiff = Math.abs(new Date(ad).getTime() - nowTs);
      const bDiff = Math.abs(new Date(bd).getTime() - nowTs);
      return aDiff - bDiff;
    }
    if (aBucket === 3) return ad.localeCompare(bd); // soonest first for future
    return bd.localeCompare(ad); // newest first for past
  };

  const incomeRows: Row[] = useMemo(() => {
    const lessonRows: Row[] = periodBillable
      .filter((l) => l.student_payment_status === "paid")
      .map((l) => ({ type: "lesson", l }));
    const prepayRows: Row[] = canManagePrepay
      ? periodTopups.map((tx) => ({ type: "prepay", tx }))
      : [];
    return [...lessonRows, ...prepayRows].sort(smartSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodBillable, periodTopups, canManagePrepay]);

  const expensesRows: Row[] = useMemo(() => {
    if (isIndependentTutor) return [];
    return periodBillable
      .filter((l) => l.tutor_payout_status === "paid")
      .map((l) => ({ type: "lesson" as const, l }))
      .sort(smartSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodBillable, isIndependentTutor]);

  const debtsRows: Row[] = useMemo(() => {
    return periodBillable
      .filter(
        (l) =>
          l.student_payment_status === "unpaid"
          || (!isIndependentTutor && l.tutor_payout_status === "unpaid"),
      )
      .map((l) => ({ type: "lesson" as const, l }))
      .sort(smartSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodBillable, isIndependentTutor]);

  const rowsForActiveTab: Row[] =
    activeTab === "income" ? incomeRows : activeTab === "expenses" ? expensesRows : debtsRows;

  const visibleLessons: LessonRow[] = useMemo(
    () => rowsForActiveTab.filter((r): r is { type: "lesson"; l: LessonRow } => r.type === "lesson").map((r) => r.l),
    [rowsForActiveTab],
  );

  // Sticky-summary totals — all derived from the same `periodBillable`.
  const totalIncome = periodBillable
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const totalExpense = periodBillable
    .filter((l) => l.tutor_payout_status === "paid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);
  const profit = totalIncome - totalExpense;
  const pendingIncome = periodBillable
    .filter((l) => l.student_payment_status === "unpaid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const pendingExpense = periodBillable
    .filter((l) => l.tutor_payout_status === "unpaid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);
  const totalDebt = pendingIncome + (isIndependentTutor ? 0 : pendingExpense);

  // === Analytics (unchanged) — use full `billable` so trends are stable regardless of period selection. ===
  // Gross margin: (income - payout) / income * 100. Capped at sensible bounds.
  const computeMarkup = (rows: LessonRow[]): number | null => {
    const valid = rows.filter(
      (l) => Number(l.student_price) > 0 && Number(l.tutor_payout) > 0
    );
    if (valid.length === 0) return null;
    const income = valid.reduce((s, l) => s + Number(l.student_price), 0);
    const payout = valid.reduce((s, l) => s + Number(l.tutor_payout), 0);
    if (income === 0) return null;
    return ((income - payout) / income) * 100;
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

  const profitSparkline = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayIdx = (today.getDay() + 6) % 7;
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
      const ts = new Date(l.starts_at).getTime();
      if (ts < firstStart) return;
      const idx = Math.floor((ts - firstStart) / (7 * 24 * 3600 * 1000));
      if (idx < 0 || idx >= buckets.length) return;
      const income = l.student_payment_status === "paid" ? Number(l.student_price) : 0;
      const expense = l.tutor_payout_status === "paid" ? Number(l.tutor_payout) : 0;
      buckets[idx].profit += income - expense;
    });
    return buckets.map((b) => ({ week: b.key, profit: b.profit }));
  }, [billable]);

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
    const TOP = 6;
    if (rows.length <= TOP) return rows;
    const head = rows.slice(0, TOP);
    const tail = rows.slice(TOP);
    const other = tail.reduce((s, r) => s + r.amount, 0);
    return [...head, { student_id: "__other__", name: t("finances.others", { count: tail.length }), amount: other }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable, profiles]);

  const pairsList = useMemo<PairOption[]>(() => {
    const keys = new Set<string>();
    lessons.forEach((l) => keys.add(`${l.tutor_id}:${l.student_id}`));
    transactions.forEach((tx) => keys.add(`${tx.tutor_id}:${tx.student_id}`));
    Object.keys(balances).forEach((key) => keys.add(key));
    Object.keys(pairRates).forEach((key) => keys.add(key));
    return Array.from(keys).map((key) => {
      const [tutor_id, student_id] = key.split(":");
      return {
        tutor_id,
        student_id,
        tutor_name: nameOf(tutor_id),
        student_name: nameOf(student_id),
        rate: pairRates[key],
      };
    }).sort((a, b) => a.student_name.localeCompare(b.student_name, "uk"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, transactions, balances, pairRates, profiles]);

  const unpaidLessonsForSheet = useMemo<UnpaidLessonOption[]>(() =>
    billable
      .filter((l) => l.student_payment_status === "unpaid")
      .map((l) => ({
        id: l.id,
        subject: l.subject,
        starts_at: l.starts_at,
        student_price: Number(l.student_price),
        student_id: l.student_id,
        tutor_id: l.tutor_id,
      })),
    [billable]
  );

  // === Mutations (logic unchanged) ===
  const togglePayment = async (
    lesson: LessonRow,
    field: "student_payment_status" | "tutor_payout_status"
  ) => {
    const next: PaymentStatus = lesson[field] === "paid" ? "unpaid" : "paid";
    const nextPaidAt = next === "paid" ? new Date().toISOString() : null;
    const paidAtField = field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";

    setLessons((prev) =>
      prev.map((l) =>
        l.id === lesson.id
          ? { ...l, [field]: next, [paidAtField]: nextPaidAt } as LessonRow
          : l
      )
    );

    const payload = field === "student_payment_status"
      ? { student_payment_status: next }
      : { tutor_payout_status: next };
    const { error } = await supabase.from("lesson_details").update(payload).eq("lesson_id", lesson.id);
    if (error) {
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
        setLessons((prev) =>
          prev.map((l) =>
            l.id === lesson.id
              ? { ...l, [field]: lesson[field], [paidAtField]: field === "student_payment_status" ? lesson.student_paid_at : lesson.tutor_paid_at } as LessonRow
              : l
          )
        );
        const revertPayload = field === "student_payment_status"
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
    if (selected.size === visibleLessons.length && visibleLessons.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleLessons.map((r) => r.id)));
    }
  };

  const bulkMark = async (field: "student_payment_status" | "tutor_payout_status") => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const nowIso = new Date().toISOString();
    const payload = field === "student_payment_status"
      ? { student_payment_status: "paid" as PaymentStatus }
      : { tutor_payout_status: "paid" as PaymentStatus };
    const paidAtField = field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";
    const previousLessons = lessons;
    setLessons((prev) =>
      prev.map((l) =>
        ids.includes(l.id) ? ({ ...l, [field]: "paid", [paidAtField]: nowIso } as LessonRow) : l
      )
    );
    const { error } = await supabase.from("lesson_details").update(payload).in("lesson_id", ids);
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
    const rows = visibleLessons.map((l) => [
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

  const allSelected = selected.size === visibleLessons.length && visibleLessons.length > 0;
  const someSelected = selected.size > 0 && !allSelected;
  const desktopColCount = 5 + (isIndependentTutor ? 0 : 3);

  // === Renderers ===
  const renderRows = (rows: Row[]) => {
    if (rows.length === 0) {
      return (
        <div className="rounded-xl border border-border bg-card p-6">
          <EmptyState
            icon={DollarSign}
            title={t("finances.noPaymentsFiltered")}
            description={t("finances.noPaymentsDesc")}
          />
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Mobile cards */}
        <div className="divide-y divide-border lg:hidden">
          {rows.map((row) => {
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
            const lessonProfit = Number(l.student_price) - Number(l.tutor_payout);
            return (
              <div key={l.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{l.subject}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(l.starts_at)}</p>
                  </div>
                  {!isIndependentTutor && (
                    <div
                      className={`text-right shrink-0 text-sm font-semibold ${
                        lessonProfit >= 0 ? "text-foreground" : "text-destructive"
                      }`}
                    >
                      {lessonProfit} ₴
                    </div>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 text-xs">
                  <div className="flex items-center justify-between gap-2 rounded-md bg-success/5 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{nameOf(l.student_id)}</p>
                      {l.student_paid_at && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {t("finances.paidDate")} {formatDate(l.student_paid_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-success">+{l.student_price} ₴</span>
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
                        <p className="truncate font-medium text-foreground">{nameOf(l.tutor_id)}</p>
                        {l.tutor_paid_at && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {t("finances.payoutDate")} {formatDate(l.tutor_paid_at)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold text-destructive">-{l.tutor_payout} ₴</span>
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

        {/* Desktop table */}
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
              {rows.map((row) => {
                if (row.type === "prepay") {
                  const tx = row.tx;
                  return (
                    <tr
                      key={`p-${tx.id}`}
                      className="border-b border-border last:border-0 bg-primary/[0.04] hover:bg-primary/10 cursor-pointer"
                      onClick={() => openWalletForPair(tx.tutor_id, tx.student_id)}
                    >
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{formatDate(tx.created_at)}</td>
                      <td className="px-3 py-3" colSpan={desktopColCount - 3}>
                        <div className="flex items-center gap-2 text-primary">
                          <Package className="h-4 w-4 shrink-0" />
                          <span className="font-medium">{t("finances.prepayLabel")}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-foreground truncate">
                            {nameOf(tx.student_id)} ↔ {nameOf(tx.tutor_id)}
                          </span>
                          {tx.note && (
                            <span className="truncate text-xs text-muted-foreground">— {tx.note}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-primary tabular-nums whitespace-nowrap">
                        {tx.lessons_delta > 0 && <div>+{tx.lessons_delta} ур.</div>}
                        {Number(tx.amount_delta) > 0 && <div>+{Number(tx.amount_delta).toFixed(0)} ₴</div>}
                      </td>
                    </tr>
                  );
                }
                const l = row.l;
                const lessonProfit = Number(l.student_price) - Number(l.tutor_payout);
                const isSelected = selected.has(l.id);
                return (
                  <tr
                    key={l.id}
                    className={`border-b border-border last:border-0 ${isSelected ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(l.id)}
                        aria-label={t("finances.selectRow")}
                      />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{formatDate(l.starts_at)}</td>
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
                      <button onClick={() => togglePayment(l, "student_payment_status")} className="mt-1 inline-block">
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
                        <button onClick={() => togglePayment(l, "tutor_payout_status")} className="mt-1 inline-block">
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
                      <td className={`px-3 py-3 text-right font-semibold ${lessonProfit >= 0 ? "text-foreground" : "text-destructive"}`}>
                        {lessonProfit} ₴
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const periodLabel =
    period === "week"
      ? t("finances.periodWeek", { defaultValue: "Цей тиждень" })
      : period === "month"
      ? t("finances.periodMonth", { defaultValue: "Цей місяць" })
      : t("finances.periodAll", { defaultValue: "Весь час" });

  return (
    <AppLayout>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">{t("finances.title")}</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isIndependentTutor ? t("finances.pageSubtitleTutor") : t("finances.pageSubtitleManager")}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {canManagePrepay && (
            <Button size="sm" onClick={() => setRecordOpen(true)} className="h-9 w-full sm:w-auto">
              <Plus className="mr-1 h-4 w-4" />
              {t("finances.recordPayment")}
            </Button>
          )}
          {!isIndependentTutor && tutorOptions.length > 1 && (
            <div className="w-full sm:w-44">
              <Select value={tutorFilter} onValueChange={setTutorFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("finances.allTutors")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("finances.allTutors")}</SelectItem>
                  {tutorOptions.map((tu) => (
                    <SelectItem key={tu.id} value={tu.id}>{tu.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <FinancesSkeleton />
      ) : (
        <>
          {/* === Sticky summary card — always visible at top while scrolling === */}
          <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{periodLabel}</span>
                <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                  {(["week", "month", "all"] as Period[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                        period === p
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {p === "week"
                        ? t("finances.periodWeekShort", { defaultValue: "Тижд." })
                        : p === "month"
                        ? t("finances.periodMonthShort", { defaultValue: "Міс." })
                        : t("finances.periodAllShort", { defaultValue: "Все" })}
                    </button>
                  ))}
                </div>
              </div>
              <div className={cn("grid gap-2 sm:gap-3", isIndependentTutor ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
                <SummaryStat
                  icon={ArrowDownLeft}
                  label={isIndependentTutor ? t("finances.received") : t("finances.incoming")}
                  value={`${totalIncome} ₴`}
                  tone="success"
                />
                {!isIndependentTutor && (
                  <SummaryStat icon={ArrowUpRight} label={t("finances.payouts")} value={`${totalExpense} ₴`} tone="neutral" />
                )}
                {!isIndependentTutor && (
                  <SummaryStat
                    icon={TrendingUp}
                    label={t("finances.profit")}
                    value={`${profit} ₴`}
                    tone={profit >= 0 ? "success" : "warning"}
                  />
                )}
                <SummaryStat
                  icon={DollarSign}
                  label={t("finances.debtsTab", { defaultValue: "Заборгованості" })}
                  value={`${totalDebt} ₴`}
                  tone={totalDebt > 0 ? "warning" : "neutral"}
                />
              </div>
            </div>
          </div>

          {/* === Main tabs: Income / Expenses / Debts === */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
              <TabsTrigger value="income" className="gap-1.5">
                <ArrowDownLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("finances.incomeTab", { defaultValue: "Доходи" })}</span>
                <span className="sm:hidden">{t("finances.incomeTabShort", { defaultValue: "Доходи" })}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">({incomeRows.length})</span>
              </TabsTrigger>
              {!isIndependentTutor && (
                <TabsTrigger value="expenses" className="gap-1.5">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("finances.expensesTab", { defaultValue: "Витрати" })}</span>
                  <span className="sm:hidden">{t("finances.expensesTabShort", { defaultValue: "Витрати" })}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">({expensesRows.length})</span>
                </TabsTrigger>
              )}
              <TabsTrigger value="debts" className="gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("finances.debtsTab", { defaultValue: "Заборгованості" })}</span>
                <span className="sm:hidden">{t("finances.debtsTabShort", { defaultValue: "Борги" })}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">({debtsRows.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="income" className="mt-4">{renderRows(incomeRows)}</TabsContent>
            {!isIndependentTutor && (
              <TabsContent value="expenses" className="mt-4">{renderRows(expensesRows)}</TabsContent>
            )}
            <TabsContent value="debts" className="mt-4">{renderRows(debtsRows)}</TabsContent>
          </Tabs>

          {/* === Bulk actions — kept as secondary, only on desktop === */}
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

          {/* === Analytics (unchanged) === */}
          {!isIndependentTutor && (
            <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{t("finances.profitTrend")}</h2>
                  <span className="text-xs text-muted-foreground">
                    {`${profitSparkline.reduce((s, b) => s + b.profit, 0)} ₴`}
                  </span>
                </div>
                <ProfitSparkline data={profitSparkline} />
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{t("finances.incomeByStudent")}</h2>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{t("finances.paidOnly")}</span>
                </div>
                <IncomeByStudentPie data={incomeByStudent} />
              </div>
            </div>
          )}

          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{t("finances.marginByTutor")}</h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">{t("finances.marginFormula")}</span>
              </div>
              {markupByTutor.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("finances.noMarginData")}</p>
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
                          <td className="px-2 py-2 text-right text-muted-foreground">{row.lessonsCount}</td>
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

          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{t("finances.weeklyTrend")}</h2>
                <span className="hidden text-xs text-muted-foreground sm:inline">{t("finances.completedOnly")}</span>
              </div>
              <FinanceWeeklyChart
                tutorNames={Object.fromEntries(
                  Object.values(profiles).map((p) => [
                    p.id,
                    `${p.first_name} ${p.last_name}`.trim() || t("common.noName"),
                  ])
                )}
                lessons={tutorScoped.map((l) => ({
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

/**
 * Compact stat tile for the sticky summary card. Smaller than a `StatCard`
 * so 4 of them fit on mobile without wrapping.
 */
function SummaryStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  tone: "success" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
      ? "text-warning"
      : "text-foreground";
  return (
    <div className="min-w-0 rounded-lg bg-secondary/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-0.5 truncate font-display text-base font-bold tabular-nums sm:text-lg", toneClass)}>
        {value}
      </p>
    </div>
  );
}
