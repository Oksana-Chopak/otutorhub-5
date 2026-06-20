import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { getLocale } from "@/lib/locale";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageFAB } from "@/components/PageFAB";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { insertNotification } from "@/lib/notifications";
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
  X,
  Trash2,
  Percent,
  Menu,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useHaptic } from "@/hooks/useHaptic";
import { burstConfetti } from "@/lib/confetti";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
const FinanceWeeklyChart = lazy(() => import("@/components/FinanceWeeklyChart").then((m) => ({ default: m.FinanceWeeklyChart })));
import { FinancesSkeleton } from "@/components/PageSkeletons";
const IncomeByStudentPie = lazy(() => import("@/components/IncomeByStudentPie").then((m) => ({ default: m.IncomeByStudentPie })));
const ProfitSparkline = lazy(() => import("@/components/ProfitSparkline").then((m) => ({ default: m.ProfitSparkline })));
import { RecordPaymentSheet, type PairOption, type UnpaidLessonOption } from "@/components/RecordPaymentSheet";
import { WalletDialog } from "@/components/WalletDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { cn } from "@/lib/utils";

type PaymentStatus = "paid" | "unpaid";
type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type Period = "week" | "month" | "all";
type TabKey = "income" | "debts";

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
  // Group lessons have lessons.student_id = NULL and one lesson_participants row per
  // student (each with its own price/payment). We flatten each participant into its
  // OWN LessonRow so income/debts/totals work unchanged. kind="group" rows carry the
  // participant id and route payment writes to lesson_participants (not lesson_details);
  // their id is synthetic (`${lessonId}::${participantId}`) so it never collides and is
  // never used as a real lesson id. No tutor_payout is tracked for groups (it would leak
  // the hub margin to students), so payout = 0 and payout_status = "paid".
  kind?: "individual" | "group";
  participant_id?: string;
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
  new Date(iso).toLocaleDateString(getLocale(), {
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
  const haptic = useHaptic();
  const { roles } = useAuth();
  const { isIndependent } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isIndependentTutor = isTutor && !isManager && isIndependent;
  const canManagePrepay = isManager || isIndependentTutor;
  const [studentFilter, setStudentFilter] = useState("all");

  const [searchParams, setSearchParams] = useSearchParams();

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [tutorFilter, setTutorFilter] = useState<string>("all");
  const [period, setPeriod] = useState<Period>("month");
  // Tab is sourced from URL (?tab=) with legacy ?filter= support so deep links keep working.
  const rawTab = searchParams.get("tab");
  const initialTab: TabKey = (rawTab === "expenses" ? "income" : rawTab as TabKey | null)
    ?? legacyFilterToTab(searchParams.get("filter"));
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  // Auto-switch to debts tab on first load if there are unpaid lessons and no explicit tab in URL
  const autoSwitchedRef = useRef(false);
  useEffect(() => {
    if (autoSwitchedRef.current) return;
    if (searchParams.get("tab") || searchParams.get("filter")) {
      autoSwitchedRef.current = true;
      return;
    }
    if (loading) return;
    const hasDebts = lessons.some(
      (l) => l.student_payment_status === "unpaid" || l.tutor_payout_status === "unpaid"
    );
    if (hasDebts) setActiveTab("debts");
    autoSwitchedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, lessons]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [balances, setBalances] = useState<Record<string, { lessons_balance: number; amount_balance: number }>>({});
  const [pairRates, setPairRates] = useState<Record<string, number | undefined>>({});
  const [walletPair, setWalletPair] = useState<WalletPair | null>(null);
  // Видалення помилкової передоплати прямо зі стріму (RPC дозволяє лише менеджеру)
  const [deletePrepayTx, setDeletePrepayTx] = useState<WalletTransaction | null>(null);
  const [deletingPrepay, setDeletingPrepay] = useState(false);
  const confirmDeletePrepay = async () => {
    if (!deletePrepayTx) return;
    setDeletingPrepay(true);
    const { error } = await supabase.rpc("wallet_delete_transaction" as any, {
      _tx_id: deletePrepayTx.id,
      _hard: true,
    });
    if (error && /updated_at|does not exist/i.test(error.message)) {
      // Жива БД ще без фіксу колонки (міграції з GitHub не застосовуються).
      // Обхід без SQL: сторно через wallet_adjust (manager-only, live з травня) —
      // компенсуюча транзакція; пару (оригінал+сторно) ховаємо зі стріму.
      const { error: adjErr } = await supabase.rpc("wallet_adjust" as any, {
        _tutor_id: deletePrepayTx.tutor_id,
        _student_id: deletePrepayTx.student_id,
        _lessons_delta: -(deletePrepayTx.lessons_delta ?? 0),
        _amount_delta: -Number(deletePrepayTx.amount_delta ?? 0),
        _note: `[storno:${deletePrepayTx.id}] Скасування помилкової передоплати`,
      });
      setDeletingPrepay(false);
      if (adjErr) {
        toast.error(t("finances.deletePrepayError"), { description: adjErr.message });
        return;
      }
      toast.success(t("finances.prepayCancelledTitle"), { description: t("finances.prepayCancelledDesc") });
      setDeletePrepayTx(null);
      fetchData();
      return;
    }
    setDeletingPrepay(false);
    if (error) {
      toast.error(t("finances.deletePrepayError"), { description: error.message });
      return;
    }
    toast.success(t("finances.prepayDeletedTitle"), { description: t("finances.prepayDeletedDesc") });
    setDeletePrepayTx(null);
    fetchData();
  };

  // Column sort (Google-Sheets style). null = smart default sort.
  type SortKey = "starts_at" | "student_paid_at" | "tutor_paid_at";
  type SortDir = "asc" | "desc";
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const cycleSort = (key: SortKey) => {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "desc" };
      if (cur.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  };


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
      { data: groupLessonsData },
      { data: profilesData, error: pErr },
      { data: txData },
      { data: balData },
      { data: ratesData },
    ] = await Promise.all([
      (() => {
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        let q = supabase
          .from("lessons")
          .select("id, subject, starts_at, status, student_id, tutor_id, lesson_details!inner(student_price, tutor_payout, student_payment_status, tutor_payout_status, student_paid_at, tutor_paid_at)")
          .gte("starts_at", oneYearAgo)
          .limit(500);
        if (isManager) q = (q as any).neq("source", "independent");
        return q.order("starts_at", { ascending: false });
      })(),
      // GROUP lessons (lessons.student_id = NULL) are excluded by the !inner join above.
      // Pull them separately with their per-student participants so group income/debts
      // show on this page too.
      (() => {
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        let q = supabase
          .from("lessons")
          .select("id, subject, starts_at, status, tutor_id, lesson_participants(id, student_id, student_price, student_payment_status, student_paid_at)")
          .not("group_id", "is", null)
          .gte("starts_at", oneYearAgo)
          .limit(500);
        if (isManager) q = (q as any).neq("source", "independent");
        return q.order("starts_at", { ascending: false });
      })(),
      supabase.from("profiles").select("id, first_name, last_name").limit(300),
      supabase
        .from("student_wallet_transactions" as any)
        .select("id, tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
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
      kind: "individual" as const,
    }));
    // Flatten each group lesson into one row per participant (their own price/payment).
    const groupRows: LessonRow[] = ((groupLessonsData ?? []) as any[]).flatMap((l) =>
      ((l.lesson_participants ?? []) as any[]).map((p) => ({
        id: `${l.id}::${p.id}`,
        subject: l.subject,
        starts_at: l.starts_at,
        status: l.status as LessonStatus,
        student_id: p.student_id,
        tutor_id: l.tutor_id,
        student_price: Number(p.student_price ?? 0),
        tutor_payout: 0,
        student_payment_status: (p.student_payment_status ?? "unpaid") as PaymentStatus,
        tutor_payout_status: "paid" as PaymentStatus, // no group payout tracked → never a tutor debt
        student_paid_at: p.student_paid_at ?? null,
        tutor_paid_at: null,
        kind: "group" as const,
        participant_id: p.id as string,
      })),
    );
    setLessons([...mapped, ...groupRows]);
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

  const studentOptions = useMemo(() => {
    const seen = new Set<string>();
    return lessons
      .filter((l) => !seen.has(l.student_id) && seen.add(l.student_id))
      .map((l) => ({ id: l.student_id, name: nameOf(l.student_id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, profiles]);

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

  const stornoedIds = useMemo(() => {
    const ids = new Set<string>();
    transactions.forEach((tx) => {
      const m = /\[storno:([0-9a-fA-F-]+)\]/.exec(tx.note ?? "");
      if (m) ids.add(m[1]);
    });
    return ids;
  }, [transactions]);

  const periodTopups = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          // Сторновані пари ховаємо: і компенсуючий запис, і скасований оригінал
          !/\[storno:/.test(tx.note ?? "") &&
          !stornoedIds.has(tx.id) &&
          (tx.kind === "topup" || tx.lessons_delta > 0 || Number(tx.amount_delta) > 0)
          && (tutorFilter === "all" || tx.tutor_id === tutorFilter)
          && inPeriod(tx.created_at),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, tutorFilter, periodStart, stornoedIds],
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

  // Manual sort helper. Nulls (unpaid/no date) always go to the bottom.
  const getSortVal = (row: Row, key: SortKey): string | null => {
    if (row.type === "prepay") return row.tx.created_at;
    const l = row.l;
    if (key === "starts_at") return l.starts_at;
    if (key === "student_paid_at") return l.student_paid_at;
    return l.tutor_paid_at;
  };
  const manualSort = (a: Row, b: Row) => {
    if (!sort) return 0;
    const av = getSortVal(a, sort.key);
    const bv = getSortVal(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return sort.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
  };
  const activeSort = (a: Row, b: Row) => (sort ? manualSort(a, b) : smartSort(a, b));

  const incomeRows: Row[] = useMemo(() => {
    const lessonRows: Row[] = periodBillable
      .filter((l) => l.student_payment_status === "paid")
      .map((l) => ({ type: "lesson", l }));
    const prepayRows: Row[] = canManagePrepay
      ? periodTopups.map((tx) => ({ type: "prepay", tx }))
      : [];
    return [...lessonRows, ...prepayRows].sort(activeSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodBillable, periodTopups, canManagePrepay, sort]);

  const expensesRows: Row[] = useMemo(() => {
    if (isIndependentTutor) return [];
    return periodBillable
      .filter((l) => l.tutor_payout_status === "paid")
      .map((l) => ({ type: "lesson" as const, l }))
      .sort(activeSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodBillable, isIndependentTutor, sort]);

  const debtsRows: Row[] = useMemo(() => {
    return periodBillable
      .filter(
        (l) =>
          l.student_payment_status === "unpaid"
          || (!isIndependentTutor && l.tutor_payout_status === "unpaid"),
      )
      .map((l) => ({ type: "lesson" as const, l }))
      .sort(activeSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodBillable, isIndependentTutor, sort]);

  const rowsForActiveTab: Row[] =
    activeTab === "income" ? incomeRows : debtsRows;

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
  // Route a student-payment write to the correct table: individual lessons keep it on
  // lesson_details (keyed by lesson_id; student_paid_at is set by a DB trigger there);
  // group participants store it per-row on lesson_participants (keyed by participant id).
  const writeStudentPayment = (lesson: LessonRow, status: PaymentStatus, paidAt: string | null) =>
    lesson.kind === "group"
      ? supabase
          .from("lesson_participants")
          .update({ student_payment_status: status, student_paid_at: paidAt })
          .eq("id", lesson.participant_id ?? "")
      : supabase
          .from("lesson_details")
          .update({ student_payment_status: status })
          .eq("lesson_id", lesson.id);

  const togglePayment = async (
    lesson: LessonRow,
    field: "student_payment_status" | "tutor_payout_status"
  ) => {
    // No tutor payout is tracked for group lessons (it would leak the hub margin to
    // students via lesson_participants), so the payout toggle is a no-op for them.
    if (field === "tutor_payout_status" && lesson.kind === "group") return;
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

    const { error } =
      field === "student_payment_status"
        ? await writeStudentPayment(lesson, next, nextPaidAt)
        : await supabase.rpc("set_lesson_tutor_payout_status", { _lesson_id: lesson.id, _status: next });
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
      haptic.error();
      toast.error(t("finances.updateStatusFailed"));
      return;
    }
    if (next === "paid") {
      haptic.success();
      const revert = async () => {
        setLessons((prev) =>
          prev.map((l) =>
            l.id === lesson.id
              ? { ...l, [field]: lesson[field], [paidAtField]: field === "student_payment_status" ? lesson.student_paid_at : lesson.tutor_paid_at } as LessonRow
              : l
          )
        );
        if (field === "student_payment_status") {
          await writeStudentPayment(lesson, lesson.student_payment_status, lesson.student_paid_at);
        } else {
          await supabase.rpc("set_lesson_tutor_payout_status", { _lesson_id: lesson.id, _status: lesson.tutor_payout_status });
        }
      };
      // Money IN (student paid the hub) is the manager's most rewarding beat —
      // give it the same warm "💰 +amount from {name}!" toast as the Dashboard,
      // not a cold "✓ marked". Payout OUT stays a calm confirmation.
      const warm = field === "student_payment_status";
      toast.success(
        warm
          ? t("dashboardExtra.paymentReceivedToast", {
              amount: `${Number(lesson.student_price).toLocaleString(getLocale())} ₴`,
              name: nameOf(lesson.student_id),
            })
          : t("finances.markedAsPayout"),
        {
          duration: 5000,
          action: { label: t("finances.undoAction"), onClick: () => { void revert(); } },
        },
      );
    } else {
      haptic.tap();
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
    const paidAtField = field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";
    const previousLessons = lessons;
    // Group payout is never tracked, so a payout bulk must skip group rows entirely.
    const selRows = lessons.filter((l) => selected.has(l.id));
    setLessons((prev) =>
      prev.map((l) =>
        ids.includes(l.id) && !(field === "tutor_payout_status" && l.kind === "group")
          ? ({ ...l, [field]: "paid", [paidAtField]: nowIso } as LessonRow)
          : l
      )
    );
    let error: unknown = null;
    if (field === "student_payment_status") {
      const indIds = selRows.filter((l) => l.kind !== "group").map((l) => l.id);
      const grpIds = selRows.filter((l) => l.kind === "group").map((l) => l.participant_id!).filter(Boolean);
      const results = await Promise.all([
        indIds.length
          ? supabase.from("lesson_details").update({ student_payment_status: "paid" as PaymentStatus }).in("lesson_id", indIds)
          : Promise.resolve({ error: null }),
        grpIds.length
          ? supabase.from("lesson_participants").update({ student_payment_status: "paid" as PaymentStatus, student_paid_at: nowIso }).in("id", grpIds)
          : Promise.resolve({ error: null }),
      ]);
      error = results.find((r) => (r as any).error)?.error ?? null;
    } else {
      const indIds = selRows.filter((l) => l.kind !== "group").map((l) => l.id);
      const res = indIds.length
        ? await supabase.rpc("set_lesson_tutor_payout_status_bulk", { _lesson_ids: indIds, _status: "paid" })
        : { error: null };
      error = (res as any).error;
    }
    setBulkBusy(false);
    if (error) {
      haptic.error();
      toast.error(t("finances.bulkUpdateFailed"));
      setLessons(previousLessons);
      return;
    }
    // Clearing a whole debt list at once is a real win — celebrate it.
    haptic.success();
    if (field === "student_payment_status") burstConfetti();
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
        {/* Mobile sort controls */}
        <div className="flex items-center gap-1 border-b border-border bg-secondary/30 px-2 py-2 text-[13px] lg:hidden">
          <span className="mr-1 text-muted-foreground">{t("finances.sortBy", { defaultValue: "Сорт.:" })}</span>
          <MobileSortChip
            label={t("finances.colDate")}
            active={sort?.key === "starts_at" ? sort.dir : null}
            onClick={() => cycleSort("starts_at")}
          />
          <MobileSortChip
            label={t("finances.sortPaidShort", { defaultValue: "Оплата" })}
            active={sort?.key === "student_paid_at" ? sort.dir : null}
            onClick={() => cycleSort("student_paid_at")}
          />
          {!isIndependentTutor && (
            <MobileSortChip
              label={t("finances.sortPayoutShort", { defaultValue: "Виплата" })}
              active={sort?.key === "tutor_paid_at" ? sort.dir : null}
              onClick={() => cycleSort("tutor_paid_at")}
            />
          )}
        </div>
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
                      <p className="text-[13px] text-muted-foreground">
                        {formatDate(tx.created_at)} · {nameOf(tx.student_id)} ↔ {nameOf(tx.tutor_id)}
                      </p>
                      {tx.note && (
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{tx.note}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right text-sm font-semibold text-primary tabular-nums">
                        {tx.lessons_delta > 0 && <div>+{tx.lessons_delta} {t("finances.lessonsUnit")}</div>}
                        {Number(tx.amount_delta) > 0 && <div>+{Number(tx.amount_delta).toFixed(0)} ₴</div>}
                      </div>
                      {isManager && (
                        <span
                          role="button"
                          aria-label={t("finances.deletePrepayAria")}
                          onClick={(e) => { e.stopPropagation(); setDeletePrepayTx(tx); }}
                          style={{ width: 32, height: 32, borderRadius: 10, display: "flex", alignItems: "center",
                            justifyContent: "center", color: "#b3441f", background: "rgba(224,85,47,.08)",
                            border: "1px solid rgba(224,85,47,.25)" }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            }
            const l = row.l;
            const isGroup = l.kind === "group";
            const lessonProfit = Number(l.student_price) - Number(l.tutor_payout);
            const studentUnpaid = l.student_payment_status === "unpaid";
            const tutorUnpaid = !isIndependentTutor && !isGroup && l.tutor_payout_status === "unpaid";
            const anyUnpaid = studentUnpaid || tutorUnpaid;
            return (
              <div
                key={l.id}
                className={cn("p-3", anyUnpaid && "bg-warning/5 border-l-2 border-l-warning")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate" style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: "#0f0f1a" }}>
                      <span className="truncate">{l.subject}</span>
                      {isGroup && <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: "#1f8e7e", background: "rgba(43,191,170,.12)", borderRadius: 7, padding: "1px 7px" }}>{t("finances.groupTag")}</span>}
                    </p>
                    <p className="text-[13px]" style={{ color: "#6b7088", marginTop: 1 }}>{formatDate(l.starts_at)}</p>
                  </div>
                  {!isIndependentTutor && !isGroup && (
                    <div
                      className={`text-right shrink-0 font-semibold ${
                        lessonProfit >= 0 ? "text-foreground" : "text-destructive"
                      }`}
                      style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15 }}
                    >
                      {lessonProfit} ₴
                    </div>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 text-[13px]">
                  <div className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5",
                    studentUnpaid ? "bg-warning/10" : "bg-success/5",
                  )}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{nameOf(l.student_id)}</p>
                      {l.student_paid_at && (
                        <p className="truncate text-[13px] text-muted-foreground">
                          {t("finances.paidDate")} {formatDate(l.student_paid_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn(
                        "text-sm font-semibold",
                        studentUnpaid ? "text-warning" : "text-success",
                      )}>+{l.student_price} ₴</span>
                      <button
                        onClick={() => togglePayment(l, "student_payment_status")}
                        aria-label={t("finances.statusPaid")}
                      >
                        <Badge
                          className={
                            l.student_payment_status === "paid"
                              ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[13px]"
                              : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[13px]"
                          }
                        >
                          {l.student_payment_status === "paid" ? t("finances.statusPaid") : t("finances.statusPending")}
                        </Badge>
                      </button>
                    </div>
                  </div>

                  {!isIndependentTutor && !isGroup && (
                    <div className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5",
                      tutorUnpaid ? "bg-warning/10" : "bg-secondary/40",
                    )}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{nameOf(l.tutor_id)}</p>
                        {l.tutor_paid_at && (
                          <p className="truncate text-[13px] text-muted-foreground">
                            {t("finances.payoutDate")} {formatDate(l.tutor_paid_at)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          "text-sm font-semibold",
                          tutorUnpaid ? "text-warning" : "text-foreground",
                        )}>-{l.tutor_payout} ₴</span>
                        <button
                          onClick={() => togglePayment(l, "tutor_payout_status")}
                          aria-label={t("finances.statusPaidOut")}
                        >
                          <Badge
                            className={
                              l.tutor_payout_status === "paid"
                                ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[13px]"
                                : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[13px]"
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
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-3 py-3 w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label={t("finances.selectAll")}
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">
                  <SortHeader
                    label={t("finances.colDate")}
                    sublabel={t("finances.sortByLessonDate", { defaultValue: "за датою уроку" })}
                    active={sort?.key === "starts_at" ? sort.dir : null}
                    onClick={() => cycleSort("starts_at")}
                    title={t("finances.sortByLessonDate", { defaultValue: "Сортувати за датою уроку" })}
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colLesson")}</th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colStudent")}</th>
                <th className="px-3 py-3 text-right font-medium text-success">
                  <SortHeader
                    align="right"
                    label={t("finances.colIncome")}
                    sublabel={t("finances.sortByPaidDateShort", { defaultValue: "за датою оплати" })}
                    active={sort?.key === "student_paid_at" ? sort.dir : null}
                    onClick={() => cycleSort("student_paid_at")}
                    title={t("finances.sortByPaidDate", { defaultValue: "Сортувати за датою оплати від учня" })}
                  />
                </th>
                {!isIndependentTutor && (
                  <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colTutor")}</th>
                )}
                {!isIndependentTutor && (
                  <th className="px-3 py-3 text-right font-medium text-destructive">
                    <SortHeader
                      align="right"
                      label={t("finances.colPayout")}
                      sublabel={t("finances.sortByPayoutDateShort", { defaultValue: "за датою виплати" })}
                      active={sort?.key === "tutor_paid_at" ? sort.dir : null}
                      onClick={() => cycleSort("tutor_paid_at")}
                      title={t("finances.sortByPayoutDate", { defaultValue: "Сортувати за датою виплати репетитору" })}
                    />
                  </th>
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
                            <span className="truncate text-[13px] text-muted-foreground">— {tx.note}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <div className="text-right font-semibold text-primary tabular-nums">
                            {tx.lessons_delta > 0 && <div>+{tx.lessons_delta} {t("finances.lessonsUnit")}</div>}
                            {Number(tx.amount_delta) > 0 && <div>+{Number(tx.amount_delta).toFixed(0)} ₴</div>}
                          </div>
                          {isManager && (
                            <button
                              type="button"
                              aria-label={t("finances.deletePrepayAria")}
                              onClick={(e) => { e.stopPropagation(); setDeletePrepayTx(tx); }}
                              style={{ width: 32, height: 32, borderRadius: 10, display: "flex", alignItems: "center",
                                justifyContent: "center", color: "#b3441f", background: "rgba(224,85,47,.08)",
                                border: "1px solid rgba(224,85,47,.25)", cursor: "pointer", flexShrink: 0 }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                const l = row.l;
                const isGroup = l.kind === "group";
                const lessonProfit = Number(l.student_price) - Number(l.tutor_payout);
                const isSelected = selected.has(l.id);
                const studentUnpaid = l.student_payment_status === "unpaid";
                const tutorUnpaid = !isIndependentTutor && !isGroup && l.tutor_payout_status === "unpaid";
                const anyUnpaid = studentUnpaid || tutorUnpaid;
                return (
                  <tr
                    key={l.id}
                    className={cn(
                      "border-b border-border last:border-0",
                      isSelected && "bg-primary/5",
                      !isSelected && anyUnpaid && "bg-warning/[0.06]",
                    )}
                  >
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(l.id)}
                        aria-label={t("finances.selectRow")}
                      />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{formatDate(l.starts_at)}</td>
                    <td className="px-3 py-3 text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {l.subject}
                        {isGroup && <span style={{ fontSize: 13, fontWeight: 700, color: "#1f8e7e", background: "rgba(43,191,170,.12)", borderRadius: 7, padding: "1px 7px" }}>{t("finances.groupTag")}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{nameOf(l.student_id)}</div>
                      {l.student_paid_at && (
                        <div className="text-[13px] text-muted-foreground">
                          {t("finances.paidDate")} {formatDate(l.student_paid_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className={cn(
                        "font-semibold",
                        studentUnpaid ? "text-warning" : "text-success",
                      )}>+{l.student_price} ₴</div>
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
                          <div className="text-[13px] text-muted-foreground">
                            {t("finances.payoutDate")} {formatDate(l.tutor_paid_at)}
                          </div>
                        )}
                      </td>
                    )}
                    {!isIndependentTutor && (
                      <td className="px-3 py-3 text-right">
                        {isGroup ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <div className={cn(
                              "font-semibold",
                              tutorUnpaid ? "text-warning" : "text-destructive",
                            )}>-{l.tutor_payout} ₴</div>
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
                          </>
                        )}
                      </td>
                    )}
                    {!isIndependentTutor && (
                      <td className={`px-3 py-3 text-right font-semibold ${!isGroup && lessonProfit < 0 ? "text-destructive" : "text-foreground"}`}>
                        {isGroup ? <span className="text-muted-foreground">—</span> : `${lessonProfit} ₴`}
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


  // ── Independent Tutor Cockpit computed values ─────────────────────────────
  const [finTab, setFinTab] = useState<"ops"|"debts"|"analytics">("ops");

  // Week bars: earned per day of week (Пн–Нд)
  const weekBars = useMemo(() => {
    const days = [
      t("finances.weekdayMon"),
      t("finances.weekdayTue"),
      t("finances.weekdayWed"),
      t("finances.weekdayThu"),
      t("finances.weekdayFri"),
      t("finances.weekdaySat"),
      t("finances.weekdaySun"),
    ];
    const sums = [0,0,0,0,0,0,0];
    const today = (new Date().getDay() + 6) % 7;
    periodBillable
      .filter(l => l.student_payment_status === "paid")
      .forEach(l => {
        const d = (new Date(l.starts_at).getDay() + 6) % 7;
        sums[d] += Number(l.student_price);
      });
    const maxVal = Math.max(...sums, 1);
    return days.map((label, i) => ({
      label, amt: sums[i], pct: Math.max(sums[i] / maxVal * 100, 4),
      isToday: i === today,
    }));
  }, [periodBillable]);

  // 6-month stacked bars
  const sixMonthBars = useMemo(() => {
    const map = new Map<string, { earned: number; pending: number }>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString(getLocale(), { month: "short" });
      map.set(key, { earned: 0, pending: 0 });
    }
    billable.forEach(l => {
      const d = new Date(l.starts_at);
      if ((now.getTime() - d.getTime()) > 6 * 30 * 86400 * 1000) return;
      const key = d.toLocaleDateString(getLocale(), { month: "short" });
      if (!map.has(key)) return;
      const entry = map.get(key)!;
      if (l.student_payment_status === "paid") entry.earned += Number(l.student_price);
      else if (l.status === "completed") entry.pending += Number(l.student_price);
    });
    const rows = Array.from(map.entries()).map(([month, v]) => ({ month, ...v }));
    const maxVal = Math.max(...rows.map(r => r.earned + r.pending), 1);
    return rows.map(r => ({ ...r, earnedPct: r.earned/maxVal*100, pendingPct: r.pending/maxVal*100 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable]);

  // Debt list: completed + unpaid, with student name
  const debtList = useMemo(() =>
    visibleLessons
      .filter(l => l.student_payment_status === "unpaid" && l.status === "completed")
      .sort((a,b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [visibleLessons]);

  const paidLessonsCount = periodBillable.filter(l => l.student_payment_status === "paid").length;
  const avgLesson = paidLessonsCount > 0 ? Math.round(totalIncome / paidLessonsCount) : 0;

  // By-student for Cockpit analytics
  const byStudentCockpit = useMemo(() => {
    const COLORS = ["#2BBFAA","#6366f1","#f59e0b","#ef4444","#ec4899","#8b5cf6"];
    return incomeByStudent.map((s,i) => ({ ...s, color: COLORS[i % COLORS.length] }));
  }, [incomeByStudent]);

  // Merged analytics — current-month earnings, month-over-month, booked forecast,
  // average lesson value and money lost to cancellations. Uses raw scoped lessons.
  const analyticsStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    let thisMonth = 0, lastMonth = 0, projected = 0, completedSum = 0, completedCount = 0, cancelledLost = 0;
    tutorScoped.forEach((l) => {
      const ts = new Date(l.starts_at).getTime();
      const price = Number(l.student_price) || 0;
      const paid = l.student_payment_status === "paid";
      if (ts >= monthStart) {
        if (paid) thisMonth += price;
        if (l.status === "cancelled") cancelledLost += price;
        else if (l.status !== "pending") projected += price; // booked total this month
        if (l.status === "completed") { completedSum += price; completedCount += 1; }
      } else if (ts >= prevStart) {
        if (paid) lastMonth += price;
      }
    });
    const momPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
    const avgLesson = completedCount > 0 ? Math.round(completedSum / completedCount) : 0;
    return { thisMonth, lastMonth, momPct, projected, completedCount, avgLesson, cancelledLost };
  }, [tutorScoped]);



  // ─────────────────────────────────────────────────────────────────────────────
  // INDEPENDENT TUTOR: Cockpit (Variant Б)
  // ─────────────────────────────────────────────────────────────────────────────
  if (isIndependentTutor) {
    const F = {
      teal:"#2BBFAA", tealD:"#25a896", tealL:"#f0fdf9",
      warn:"#f59e0b", warnD:"#b4740b", warnBg:"rgba(245,158,11,.1)", warnBorder:"rgba(245,158,11,.3)",
      border:"#eceef3", bg:"#F5F4F0", surface:"#fff",
      txt:"#0f0f1a", sub:"#9398b0", muted:"#b0b4c8",
      display:"Inter, system-ui, sans-serif", body:"'Plus Jakarta Sans', system-ui, sans-serif",
    };

    const pill = (p: Period) => (
      <button key={p} onClick={() => setPeriod(p)}
        style={{
          height:34, padding:"0 16px", borderRadius:999, border:"none", cursor:"pointer",
          fontFamily:F.display, fontWeight:700, fontSize:14,
          background: period===p ? F.teal : F.bg,
          color: period===p ? "#0f0f1a" : F.sub,
          boxShadow: period===p ? "0 4px 12px -4px rgba(43,191,170,.5)" : "none",
          transition:"all .15s",
        }}>
        {p==="week"?t("finances.periodWeekShort"):p==="month"?t("finances.periodMonthShort"):t("finances.periodAllShort")}
      </button>
    );

    const Tab = ({ id, label, count }: { id: typeof finTab; label: string; count?: number }) => (
      <button onClick={() => setFinTab(id)}
        style={{
          flex:1, height:44, border:"none", cursor:"pointer", background:"transparent",
          fontFamily:F.display, fontWeight:700, fontSize:15,
          color: finTab===id ? F.teal : F.muted,
          borderBottom: `2.5px solid ${finTab===id ? F.teal : "transparent"}`,
          display:"flex", alignItems:"center", justifyContent:"center", gap:5,
        }}>
        {label}
        {count !== undefined && count > 0 && (
          <span style={{ background:F.warn, color:"#fff", borderRadius:999, fontSize: 13,
            fontWeight:800, padding:"0 6px", height:18, display:"inline-flex", alignItems:"center" }}>
            {count}
          </span>
        )}
      </button>
    );

    return (
      <AppLayout>
        {/* Period pills */}
        <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
          {(["week","month","all"] as Period[]).map(pill)}
        </div>

        {/* ── Desktop 2-col layout ─────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-5">

          {/* LEFT column */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* Stats row */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {/* Earned — dark gradient */}
              <div style={{ gridColumn:"1/-1", borderRadius:20, padding:"18px 20px",
                background:"linear-gradient(135deg,#0f0f1a,#1a1a2e)", position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:-20, right:-20, width:100, height:100,
                  borderRadius:"50%", background:"radial-gradient(circle,rgba(43,191,170,.35),transparent)" }} />
                <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:"rgba(255,255,255,.5)",
                  textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>
                  💰 {t("finances.received")}
                </p>
                <p style={{ fontFamily:F.display, fontWeight:900, fontSize:38, color:F.teal,
                  letterSpacing:"-0.025em", lineHeight:1 }}>
                  {totalIncome.toLocaleString(getLocale())} ₴
                </p>
                {pendingIncome > 0 && (
                  <p style={{ fontFamily:F.body, fontSize:13, color:"rgba(255,255,255,.45)", marginTop:6 }}>
                    + {t("finances.pendingAmount", { sum: pendingIncome.toLocaleString(getLocale()) })}
                  </p>
                )}
              </div>

              {/* Pending — warn */}
              <div style={{ borderRadius:16, padding:"14px 16px",
                background:F.warnBg, border:`1px solid ${F.warnBorder}` }}>
                <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:F.warnD,
                  textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>
                  ⏳ {t("finances.pendingLabel")}
                </p>
                <p style={{ fontFamily:F.display, fontWeight:800, fontSize:22, color:F.warnD }}>
                  {pendingIncome.toLocaleString(getLocale())} ₴
                </p>
                <p style={{ fontFamily:F.body, fontSize: 13, color:F.warnD, opacity:0.7, marginTop:2 }}>
                  {t("finances.lessonsCount", { count: debtList.length })}
                </p>
              </div>

              {/* Avg */}
              <div style={{ borderRadius:16, padding:"14px 16px",
                background:"rgba(139,92,246,.08)", border:"1px solid rgba(139,92,246,.2)" }}>
                <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:"#7c3aed",
                  textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>
                  📊 {t("finances.avgLesson")}
                </p>
                <p style={{ fontFamily:F.display, fontWeight:800, fontSize:22, color:"#7c3aed" }}>
                  {avgLesson.toLocaleString(getLocale())} ₴
                </p>
                <p style={{ fontFamily:F.body, fontSize: 13, color:"#7c3aed", opacity:0.7, marginTop:2 }}>
                  {t("finances.lessonsCount", { count: paidLessonsCount })}
                </p>
              </div>
            </div>

            {/* 3 tabs */}
            <div style={{ borderRadius:18, background:F.surface, border:`1px solid ${F.border}`,
              overflow:"hidden", boxShadow:"0 2px 10px -4px rgba(15,15,26,.06)" }}>
              {/* Tab header */}
              <div style={{ display:"flex", borderBottom:`1px solid ${F.border}` }}>
                <Tab id="ops" label={t("finances.tabOps")} />
                <Tab id="debts" label={t("finances.tabDebts")} count={debtList.length} />
                <Tab id="analytics" label={t("finances.tabAnalytics")} />
              </div>

              {/* ── OPS tab ──────────────────────────────────────────────────── */}
              {finTab === "ops" && (
                <div style={{ padding:"16px 16px 20px" }}>
                  {/* Mini weekly bar chart */}
                  <div style={{ display:"flex", alignItems:"flex-end", gap:5, height:48, marginBottom:16 }}>
                    {weekBars.map(bar => (
                      <div key={bar.label} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                        <div style={{ width:"100%", borderRadius:6,
                          height:`${bar.pct}%`, minHeight:4,
                          background: bar.isToday ? F.teal : bar.amt>0 ? "rgba(43,191,170,.3)" : F.border,
                          transition:"height .3s" }} />
                        <span style={{ fontFamily:F.display, fontSize: 13, fontWeight:700,
                          color: bar.isToday ? F.teal : F.muted }}>{bar.label}</span>
                      </div>
                    ))}
                  </div>
                  {/* Transaction list */}
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {visibleLessons.slice(0, 20).map(l => {
                      const paid = l.student_payment_status === "paid";
                      return (
                        <div key={l.id} style={{ display:"flex", alignItems:"center", gap:12,
                          padding:"10px 12px", borderRadius:14,
                          background: paid ? "rgba(34,197,94,.05)" : F.warnBg,
                          border: `1px solid ${paid ? "rgba(34,197,94,.15)" : F.warnBorder}` }}>
                          <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
                            background: paid ? "rgba(34,197,94,.1)" : F.warnBg,
                            display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>
                            {paid ? "✓" : "⏳"}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <p style={{ fontFamily:F.display, fontWeight:700, fontSize:14, color:F.txt,
                              whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {nameOf(l.student_id)}
                            </p>
                            <p style={{ fontFamily:F.body, fontSize: 13, color:F.sub }}>
                              {new Date(l.starts_at).toLocaleDateString(getLocale(),{day:"numeric",month:"short"})} · {l.subject}
                            </p>
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0 }}>
                            <p style={{ fontFamily:F.display, fontWeight:800, fontSize:15,
                              color: paid ? "#16a34a" : F.warnD }}>
                              {paid ? "+" : ""}{Number(l.student_price).toLocaleString(getLocale())} ₴
                            </p>
                            <button onClick={() => togglePayment(l, "student_payment_status")}
                              style={{ fontFamily:F.display, fontWeight:700, fontSize: 13,
                                background: paid ? "rgba(34,197,94,.15)" : F.warnBg,
                                color: paid ? "#16a34a" : F.warnD,
                                border:`1px solid ${paid?"rgba(34,197,94,.3)":F.warnBorder}`,
                                borderRadius:999, padding:"2px 8px", cursor:"pointer", marginTop:3 }}>
                              {paid ? t("finances.paidChip") : t("finances.pendingChip")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {visibleLessons.length === 0 && (
                      <p style={{ textAlign:"center", padding:"20px 0", color:F.muted, fontFamily:F.body, fontSize:14 }}>
                        {t("finances.noOpsForPeriod")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── DEBTS tab ─────────────────────────────────────────────────── */}
              {finTab === "debts" && (
                <div style={{ padding:"16px 16px 20px" }}>
                  {debtList.length === 0 ? (
                    <div style={{ textAlign:"center", padding:"32px 0" }}>
                      <p style={{ fontSize:36, marginBottom:8 }}>☀️</p>
                      <p style={{ fontFamily:F.display, fontWeight:700, fontSize:17, color:F.txt }}>
                        {t("finances.allSettledTitle")}
                      </p>
                      <p style={{ fontFamily:F.body, fontSize:14, color:F.sub, marginTop:4 }}>
                        {t("finances.allSettledDesc")}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Auto-reminder hint */}
                      <Link to="/profile" style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12,
                        padding:"10px 13px", borderRadius:12, textDecoration:"none",
                        background:"rgba(43,191,170,.07)", border:"1px solid rgba(43,191,170,.25)" }}>
                        <span style={{ fontSize:15 }}>🔔</span>
                        <span style={{ flex:1, fontFamily:F.body, fontSize:13, color:F.txt, lineHeight:1.35 }}>
                          {t("finances.autoReminderHintPre")} <b>{t("finances.autoReminderHintBold")}</b> {t("finances.autoReminderHintPost")}
                        </span>
                        <span style={{ fontFamily:F.display, fontWeight:700, fontSize:13, color:"#1f8e7e", flexShrink:0 }}>{t("finances.configureLink")}</span>
                      </Link>
                      {/* Summary warning */}
                      <div style={{ borderRadius:14, padding:"12px 14px", marginBottom:14,
                        background:F.warnBg, border:`1px solid ${F.warnBorder}`,
                        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <div>
                          <p style={{ fontFamily:F.display, fontWeight:700, fontSize:16, color:F.warnD }}>
                            ⚠️ {t("finances.notReceivedAmount", { sum: pendingIncome.toLocaleString(getLocale()) })}
                          </p>
                          <p style={{ fontFamily:F.body, fontSize:13, color:F.warnD, opacity:0.8 }}>
                            {t("finances.lessonsUnpaid", { count: debtList.length })}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            const ids = debtList.map(l => l.id);
                            const nowIso = new Date().toISOString();
                            // Route each debt to the right table (group → lesson_participants).
                            await Promise.all(debtList.map(l => writeStudentPayment(l, "paid", nowIso)));
                            setLessons(prev => prev.map(l =>
                              ids.includes(l.id) ? {...l, student_payment_status:"paid", student_paid_at: nowIso} : l
                            ));
                            toast.success(t("finances.allMarkedPaid"));
                          }}
                          style={{ height:38, padding:"0 14px", borderRadius:10, border:"none",
                            background:"rgba(245,158,11,.25)", color:F.warnD,
                            fontFamily:F.display, fontWeight:700, fontSize:13, cursor:"pointer",
                            whiteSpace:"nowrap" }}>
                          {t("finances.markAll")}
                        </button>
                      </div>
                      {/* Per-lesson debt cards */}
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {debtList.map(l => (
                          <div key={l.id} style={{ display:"flex", alignItems:"center", gap:12,
                            padding:"11px 13px", borderRadius:14,
                            background:F.surface, border:`1px solid ${F.border}` }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <p style={{ fontFamily:F.display, fontWeight:700, fontSize:15, color:F.txt,
                                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                {nameOf(l.student_id)}
                              </p>
                              <p style={{ fontFamily:F.body, fontSize: 13, color:F.sub }}>
                                {new Date(l.starts_at).toLocaleDateString(getLocale(),{day:"numeric",month:"short"})} · {l.subject}
                              </p>
                            </div>
                            <p style={{ fontFamily:F.display, fontWeight:800, fontSize:16,
                              color:F.warnD, flexShrink:0 }}>
                              {Number(l.student_price).toLocaleString(getLocale())} ₴
                            </p>
                            <button
                              onClick={() => {
                                insertNotification({
                                  userId: l.student_id,
                                  type: `payment_reminder_${l.id}_${Date.now()}`,
                                  title: t("finances.paymentReminderPushTitle"),
                                  body: t("finances.paymentReminderPushBody", { date: new Date(l.starts_at).toLocaleDateString(getLocale(), { day: "numeric", month: "short" }), sum: Number(l.student_price).toLocaleString(getLocale()) }),
                                  link: "/schedule",
                                });
                                toast.success(t("finances.reminderSent"), { description: nameOf(l.student_id) });
                              }}
                              style={{ height:32, padding:"0 12px", borderRadius:9, border:"none",
                                background:"rgba(245,158,11,.18)", color:F.warnD,
                                fontFamily:F.display, fontWeight:700, fontSize: 13, cursor:"pointer",
                                flexShrink:0 }}>
                              {t("finances.remindBtn")}
                            </button>
                            <button
                              onClick={() => togglePayment(l, "student_payment_status")}
                              aria-label={t("finances.statusPaid")}
                              style={{ width:32, height:32, borderRadius:9, border:"1.5px solid rgba(43,191,170,.4)",
                                background:"#f0fdf9", color:"#1f8e7e", cursor:"pointer", flexShrink:0,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontWeight:800, fontSize:14 }}>
                              ✓
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── ANALYTICS tab ─────────────────────────────────────────────── */}
              {finTab === "analytics" && (
                <div style={{ padding:"16px 16px 22px", display:"flex", flexDirection:"column", gap:20 }}>

                  {/* This month + month-over-month */}
                  <div>
                    <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>{t("finances.thisMonth")}</p>
                    <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
                      <span style={{ fontFamily:F.display, fontWeight:800, fontSize:34, letterSpacing:"-0.02em", color:F.txt }}>
                        {analyticsStats.thisMonth.toLocaleString(getLocale())} ₴
                      </span>
                      {analyticsStats.momPct !== null && (
                        <span style={{ display:"inline-flex", alignItems:"center", gap:4, borderRadius:999, padding:"4px 10px",
                          fontFamily:F.display, fontWeight:700, fontSize: 13,
                          background: analyticsStats.momPct >= 0 ? "rgba(34,197,94,.12)" : "rgba(245,158,11,.14)",
                          color: analyticsStats.momPct >= 0 ? "#16a34a" : F.warnD }}>
                          {analyticsStats.momPct >= 0 ? "▲" : "▼"} {t("finances.vsLastMonth", { pct: Math.abs(analyticsStats.momPct) })}
                        </span>
                      )}
                    </div>
                    {analyticsStats.projected > analyticsStats.thisMonth && (
                      <p style={{ fontFamily:F.body, fontSize:13, color:F.sub, marginTop:7, lineHeight:1.45 }}>
                        {t("finances.forecastPre")} <b style={{ color:F.txt }}>≈ {analyticsStats.projected.toLocaleString(getLocale())} ₴</b> {t("finances.forecastPost")}
                      </p>
                    )}
                  </div>

                  {/* Not received */}
                  {pendingIncome > 0 && (
                    <div style={{ borderRadius:16, padding:"14px 16px", background:F.warnBg, border:`1px solid ${F.warnBorder}` }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                        <div>
                          <p style={{ fontFamily:F.display, fontWeight:800, fontSize:18, color:F.warnD }}>
                            {t("finances.notReceivedAmount", { sum: pendingIncome.toLocaleString(getLocale()) })}
                          </p>
                          <p style={{ fontFamily:F.body, fontSize: 13, color:F.warnD, opacity:0.85, marginTop:1 }}>
                            {t("finances.lessonsAwaitPayment", { count: debtList.length })}
                          </p>
                        </div>
                        <button onClick={() => setFinTab("debts")}
                          style={{ flexShrink:0, height:36, padding:"0 14px", borderRadius:10, border:"none", cursor:"pointer",
                            background:"rgba(245,158,11,.18)", color:F.warnD, fontFamily:F.display, fontWeight:700, fontSize:13 }}>
                          {t("finances.whoOwes")}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 6-month trend */}
                  <div>
                    <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>{t("finances.income6Months")}</p>
                    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:84 }}>
                      {sixMonthBars.map(bar => (
                        <div key={bar.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                          <div style={{ width:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end", height:64, gap:2 }}>
                            {bar.pendingPct > 0 && (
                              <div style={{ width:"100%", borderRadius:"3px 3px 0 0", height:`${bar.pendingPct}%`, minHeight:3, background:"rgba(245,158,11,.35)" }} />
                            )}
                            {bar.earnedPct > 0 && (
                              <div style={{ width:"100%", borderRadius: bar.pendingPct>0?"0":"3px 3px 0 0", height:`${bar.earnedPct}%`, minHeight:bar.earned>0?4:0, background:F.teal }} />
                            )}
                          </div>
                          <span style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:F.muted }}>{bar.month}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:14, marginTop:10 }}>
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:F.body, fontSize: 13, color:F.sub }}>
                        <span style={{ width:9, height:9, borderRadius:2, background:F.teal }} /> {t("finances.received")}
                      </span>
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:F.body, fontSize: 13, color:F.sub }}>
                        <span style={{ width:9, height:9, borderRadius:2, background:"rgba(245,158,11,.55)" }} /> {t("finances.pendingLabel")}
                      </span>
                    </div>
                  </div>

                  {/* Top students */}
                  {byStudentCockpit.length > 0 && (
                    <div>
                      <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>{t("finances.topStudentsByIncome")}</p>
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {byStudentCockpit.map(s => {
                          const maxAmt = byStudentCockpit[0]?.amount ?? 1;
                          const pct = Math.max((s.amount / maxAmt) * 100, 4);
                          return (
                            <div key={s.student_id}>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                                <span style={{ fontFamily:F.body, fontSize:13, color:F.txt }}>{s.name}</span>
                                <span style={{ fontFamily:F.display, fontWeight:700, fontSize:13, color:F.txt }}>{s.amount.toLocaleString(getLocale())} ₴</span>
                              </div>
                              <div style={{ height:7, borderRadius:999, background:F.border }}>
                                <div style={{ height:"100%", borderRadius:999, width:`${pct}%`, background:s.color, transition:"width .4s ease" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div style={{ borderRadius:16, padding:"14px 16px", background:F.surface, border:`1px solid ${F.border}` }}>
                      <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em" }}>{t("finances.lessonsThisMonth")}</p>
                      <p style={{ fontFamily:F.display, fontWeight:800, fontSize:26, color:F.txt, marginTop:4 }}>{analyticsStats.completedCount}</p>
                    </div>
                    <div style={{ borderRadius:16, padding:"14px 16px", background:F.surface, border:`1px solid ${F.border}` }}>
                      <p style={{ fontFamily:F.display, fontSize: 13, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em" }}>{t("finances.avgLesson")}</p>
                      <p style={{ fontFamily:F.display, fontWeight:800, fontSize:26, color:F.txt, marginTop:4 }}>{analyticsStats.avgLesson.toLocaleString(getLocale())} ₴</p>
                    </div>
                  </div>

                  {/* Cancellations */}
                  {analyticsStats.cancelledLost > 0 && (
                    <div style={{ borderRadius:14, padding:"12px 14px", background:"rgba(239,68,68,.06)", border:"1px solid rgba(239,68,68,.2)", display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:18 }}>🚫</span>
                      <p style={{ fontFamily:F.body, fontSize:13, color:F.txt, lineHeight:1.4 }}>
                        {t("finances.cancellationsPre")} <b>{analyticsStats.cancelledLost.toLocaleString(getLocale())} ₴</b>{t("finances.cancellationsPost")}
                      </p>
                    </div>
                  )}

                  {/* Export */}
                  <button onClick={exportCsv}
                    style={{ height:46, borderRadius:14, border:`1px solid ${F.border}`, background:F.surface, cursor:"pointer",
                      fontFamily:F.display, fontWeight:700, fontSize:14, color:F.sub,
                      display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                    <Download className="h-4 w-4" /> {t("finances.downloadCsv")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT sidebar — desktop only */}
          <div className="hidden lg:flex flex-col gap-4" style={{ width:300, flexShrink:0 }}>
            {/* Debt summary */}
            {debtList.length > 0 && (
              <div style={{ borderRadius:18, padding:"16px 18px",
                background:F.warnBg, border:`1px solid ${F.warnBorder}` }}>
                <p style={{ fontFamily:F.display, fontWeight:700, fontSize:16, color:F.warnD, marginBottom:4 }}>
                  ⚠️ {t("finances.notReceivedAmount", { sum: pendingIncome.toLocaleString(getLocale()) })}
                </p>
                <p style={{ fontFamily:F.body, fontSize:13, color:F.warnD, opacity:0.8 }}>
                  {t("finances.lessonsUnpaid", { count: debtList.length })}
                </p>
              </div>
            )}
            {/* Export */}
            <button onClick={exportCsv}
              style={{ height:44, borderRadius:14, border:`1px solid ${F.border}`,
                background:F.surface, cursor:"pointer", fontFamily:F.display,
                fontWeight:700, fontSize:14, color:F.sub,
                display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              <Download className="h-4 w-4" /> {t("finances.downloadCsv")}
            </button>
          </div>

        </div>
      </AppLayout>
    );
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="hidden lg:block font-display text-xl font-bold text-foreground sm:text-2xl">{t("finances.title")}</h1>
          <p className="text-[13px] text-muted-foreground sm:text-sm">
            {isIndependentTutor ? t("finances.pageSubtitleTutor") : t("finances.pageSubtitleManager")}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
          {/* Student filter — tutor view */}
          {isIndependentTutor && studentOptions.length > 1 && (
            <div className="w-full sm:w-44">
              <Select value={studentFilter} onValueChange={setStudentFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("finances.allStudents")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("finances.allStudents")}</SelectItem>
                  {studentOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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
                <span className="text-[13px] font-medium text-muted-foreground">{periodLabel}</span>
                <div className="flex gap-1.5">
                  {(["week", "month", "all"] as Period[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      style={{
                        height: 32, padding: "0 12px", borderRadius: 999, border: "none", cursor: "pointer",
                        fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13,
                        background: period === p ? "var(--teal,#2BBFAA)" : "var(--bg,#F5F4F0)",
                        color: period === p ? "#0f0f1a" : "var(--sub,#9398b0)",
                        boxShadow: period === p ? "0 4px 12px -4px rgba(43,191,170,.5)" : "none",
                        transition: "all .15s",
                      }}
                    >
                      {p === "week"
                        ? t("finances.periodWeekShort")
                        : p === "month"
                        ? t("finances.periodMonthShort")
                        : t("finances.periodAllShort")}
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

          {activeTab === "debts" && searchParams.get("filter") && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              <span className="flex-1 text-foreground">{t("finances.debtsBannerHint")}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const p = new URLSearchParams(searchParams);
                  p.delete("filter");
                  setSearchParams(p, { replace: true });
                }}
              >
                {t("finances.showAll")}
              </Button>
            </div>
          )}

          {/* === Debt alert — shows when there are unpaid lessons === */}
          {totalDebt > 0 && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3"
              style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.35)" }}>
              <div className="flex items-center gap-2.5">
                <span className="text-xl">⚠️</span>
                <div>
                  <p className="text-[15px] font-bold" style={{ color: "#b45309" }}>
                    {t("finances.debtTitle", { sum: totalDebt })}
                  </p>
                  <p className="text-[13px]" style={{ color: "#b45309", opacity: 0.8 }}>
                    {t("finances.debtAwaiting", { count: debtsRows.length })}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  // Згрупувати борги по учнях і надіслати кожному одне нагадування
                  const byStudent = new Map<string, { count: number; sum: number }>();
                  debtsRows.forEach((row) => {
                    const l = row as unknown as { student_id: string; student_price: number | null };
                    const cur = byStudent.get(l.student_id) ?? { count: 0, sum: 0 };
                    cur.count += 1;
                    cur.sum += Number(l.student_price) || 0;
                    byStudent.set(l.student_id, cur);
                  });
                  // Fire all reminders in parallel — they're independent inserts.
                  await Promise.all(
                    Array.from(byStudent).map(([studentId, agg]) =>
                      insertNotification({
                        userId: studentId,
                        type: `payment_reminder_bulk_${Date.now()}_${studentId.slice(0, 8)}`,
                        title: t("finances.remindPushTitle"),
                        body: t("finances.remindPushBody", { count: agg.count, sum: agg.sum.toLocaleString(getLocale()) }),
                        link: "/student/payments",
                      }),
                    ),
                  );
                  const sent = byStudent.size;
                  toast.success(t("finances.remindSentTitle"), { description: t("finances.remindSentDesc", { count: sent }) });
                  handleTabChange("debts");
                }}
                className="flex-shrink-0 rounded-[10px] px-3 py-1.5 text-[13px] font-bold transition-opacity hover:opacity-80"
                style={{ background: "rgba(245,158,11,.2)", color: "#b45309", border: "1px solid rgba(245,158,11,.4)" }}>
                {t("people.remindBtn")}
              </button>
            </div>
          )}

          {/* === Tabs header with CSV download === */}
          <div className="flex items-center justify-between mb-0">
            <div className="flex-1" />
            <button
              onClick={exportCsv}
              className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-gray-100"
              style={{ color: "var(--sub,#6b7088)", border: "1px solid var(--border,#eceef3)" }}
              title={t("finances.exportCsv")}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>

          {/* === Main tabs: Income / Debts === */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2 h-11 bg-transparent border-b rounded-none p-0" style={{borderColor:"var(--border,#eceef3)"}}>
              <TabsTrigger value="income" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-[#2BBFAA] data-[state=active]:text-[#2BBFAA] data-[state=active]:shadow-none data-[state=active]:bg-transparent font-medium h-11 -mb-px">
                <ArrowDownLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("finances.incomeTab", { defaultValue: "Доходи" })}</span>
                <span className="sm:hidden">{t("finances.incomeTabShort", { defaultValue: "Доходи" })}</span>
                <span className="ml-1 text-[13px] text-muted-foreground">({incomeRows.filter((r) => r.type === "lesson").length})</span>
              </TabsTrigger>
              <TabsTrigger value="debts" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-[#2BBFAA] data-[state=active]:text-[#2BBFAA] data-[state=active]:shadow-none data-[state=active]:bg-transparent font-medium h-11 -mb-px">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("finances.debtsTab", { defaultValue: "Заборгованості" })}</span>
                <span className="sm:hidden">{t("finances.debtsTabShort", { defaultValue: "Борги" })}</span>
                <span className="ml-1 text-[13px] text-muted-foreground">({debtsRows.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="income" className="mt-4">{renderRows(incomeRows)}</TabsContent>
            <TabsContent value="debts" className="mt-4">{renderRows(debtsRows)}</TabsContent>
          </Tabs>

          {/* === Selection bar — sticky, only when rows are selected (desktop) === */}
          {selected.size > 0 && (
            <div
              className="sticky bottom-4 z-30 mt-4 hidden items-center gap-2 rounded-[14px] border-[0.5px] bg-white px-4 py-3 lg:flex"
              style={{ borderColor: "var(--border,#eceef3)", boxShadow: "0 12px 32px -12px rgba(15,15,26,.3)" }}
            >
              <span className="text-[14px] font-bold text-foreground">
                {t("finances.selectedCount", { count: selected.size })}
              </span>
              <div className="flex-1" />
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => bulkMark("student_payment_status")}
                className="flex h-10 items-center gap-1.5 rounded-[12px] px-4 text-[14px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", boxShadow: "0 6px 16px -6px rgba(43,191,170,.6)", fontFamily: "Inter, system-ui, sans-serif" }}
              >
                <CheckCheck className="h-4 w-4" />
                {t("finances.markStudentsPaid")}
              </button>
              {!isIndependentTutor && (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => bulkMark("tutor_payout_status")}
                  className="flex h-10 items-center gap-1.5 rounded-[12px] border-[0.5px] bg-white px-4 text-[14px] font-bold transition-colors hover:bg-[#f0fdf9] disabled:opacity-50"
                  style={{ borderColor: "#5DCAA5", color: "#1f8e7e", fontFamily: "Inter, system-ui, sans-serif" }}
                >
                  <CheckCheck className="h-4 w-4" />
                  {t("finances.markTutorsPaid")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label={t("common.close")}
                className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors hover:bg-[rgba(15,15,26,.05)]"
                style={{ color: "var(--sub,#6b7088)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* === Analytics (unchanged) === */}
          {!isIndependentTutor && (
            <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{t("finances.profitTrend")}</h2>
                  <span className="text-[13px] text-muted-foreground">
                    {`${profitSparkline.reduce((s, b) => s + b.profit, 0)} ₴`}
                  </span>
                </div>
                <Suspense fallback={<div className="animate-pulse" style={{ height: 180, borderRadius: 16, background: "#f3f4f6" }} />}><ProfitSparkline data={profitSparkline} /></Suspense>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{t("finances.incomeByStudent")}</h2>
                  <span className="hidden text-[13px] text-muted-foreground sm:inline">{t("finances.paidOnly")}</span>
                </div>
                <Suspense fallback={<div className="animate-pulse" style={{ height: 180, borderRadius: 16, background: "#f3f4f6" }} />}><IncomeByStudentPie data={incomeByStudent} /></Suspense>
              </div>
            </div>
          )}

          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{t("finances.marginByTutor")}</h2>
                <span className="hidden text-[13px] text-muted-foreground sm:inline">{t("finances.marginFormula")}</span>
              </div>
              {markupByTutor.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("finances.noMarginData")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[15px]">
                    <thead>
                      <tr className="border-b border-border text-[13px] text-muted-foreground">
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
                <span className="hidden text-[13px] text-muted-foreground sm:inline">{t("finances.completedOnly")}</span>
              </div>
              <Suspense fallback={<div className="animate-pulse" style={{ height: 180, borderRadius: 16, background: "#f3f4f6" }} />}><FinanceWeeklyChart
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
              /></Suspense>
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
      {/* Підтвердження видалення передоплати */}
      <AlertDialog open={!!deletePrepayTx} onOpenChange={(o) => !deletingPrepay && !o && setDeletePrepayTx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800 }}>
              {t("finances.deletePrepayConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletePrepayTx && (
                <>
                  {deletePrepayTx.lessons_delta > 0 && <b>+{deletePrepayTx.lessons_delta} {t("finances.lessonsUnit")} </b>}
                  {Number(deletePrepayTx.amount_delta) > 0 && <b>+{Number(deletePrepayTx.amount_delta).toFixed(0)} ₴ </b>}
                  · {nameOf(deletePrepayTx.student_id)} ↔ {nameOf(deletePrepayTx.tutor_id)}
                  <br />{t("finances.deletePrepayConfirmDesc")}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPrepay}>{t("finances.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingPrepay}
              onClick={(e) => { e.preventDefault(); confirmDeletePrepay(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingPrepay && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("finances.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canManagePrepay && (
        <PageFAB onClick={() => setRecordOpen(true)} label={t("finances.recordPayment")} />
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
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground sm:text-[13px]">
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-0.5 truncate font-display text-base font-bold tabular-nums sm:text-lg", toneClass)}>
        {value}
      </p>
    </div>
  );
}

/**
 * Google-Sheets-style sortable column header. Click to toggle desc → asc → off.
 */
function SortHeader({
  label,
  sublabel,
  active,
  onClick,
  align = "left",
  title,
}: {
  label: string;
  sublabel?: string;
  active: "asc" | "desc" | null;
  onClick: () => void;
  align?: "left" | "right";
  title?: string;
}) {
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 transition-colors hover:bg-muted/60 cursor-pointer",
        active ? "text-foreground" : "",
        align === "right" && "flex-row-reverse",
      )}
    >
      <span
        className="inline-flex flex-col leading-tight"
        style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}
      >
        <span>{label}</span>
        {sublabel && (
          <span className="text-[13px] font-normal text-muted-foreground normal-case">{sublabel}</span>
        )}
      </span>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "opacity-100 text-primary" : "opacity-70")} />
    </button>
  );
}

/**
 * Mobile-friendly sort chip. Compact pill with arrow indicator.
 */
function MobileSortChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: "asc" | "desc" | null;
  onClick: () => void;
}) {
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <Icon className="h-3 w-3" />
    </button>
  );
}

