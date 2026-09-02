import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { ErrorState } from "@/components/ErrorState";
import { confirmDialog } from "@/hooks/useConfirm";
import { bumpDataVersion, useDataVersion } from "@/lib/dataBus";
import { logEvent } from "@/lib/analytics";
import { getLocale } from "@/lib/locale";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageFAB } from "@/components/PageFAB";
import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafe, updateLessonDetailsSafeEach } from "@/lib/lessonDetailsSafe";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useMediaQuery } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { isBillableLesson, isStudentDebtLesson, isPayoutDueLesson, paidIncome, paidExpense, grossMarkupPct, sumByCurrency } from "@/lib/financials";
import { formatPrice} from "@/lib/currency";

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
  /** Cancelled lesson whose price is a withheld cancellation fee (billable). */
  is_cancellation_fee?: boolean;
  /** №8 (ідеї 01.09): для «₴/год» у розрізі по предметах. */
  duration_minutes?: number;
  // Group lessons have lessons.student_id = NULL and one lesson_participants row per
  // student (each with its own price/payment). We flatten each participant into its
  // OWN LessonRow so income/debts/totals work unchanged. kind="group" rows carry the
  // participant id and route payment writes to lesson_participants (not lesson_details);
  // their id is synthetic (`${lessonId}::${participantId}`) so it never collides and is
  // never used as a real lesson id. No tutor_payout is tracked for groups (it would leak
  // the hub margin to students), so payout = 0 and payout_status = "paid".
  kind?: "individual" | "group";
  /** Mirrors kind==="group" for the shared billable predicate: the synthetic
   * payout_status="paid" must not make a FUTURE group lesson count as billable. */
  is_group?: boolean;
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

const F = {
  teal:"#2BBFAA", tealD:"#25a896", tealL:"#f0fdf9",
  warn:"#f59e0b", warnD:"#b4740b", warnBg:"rgba(245,158,11,.1)", warnBorder:"rgba(245,158,11,.3)",
  border:"var(--ds-border,#eceef3)", bg:"var(--ds-bg,#F5F4F0)", surface:"var(--ds-surface,#fff)",
  txt:"var(--ds-txt,#0f0f1a)", sub:"var(--sub,#666b82)", muted:"var(--ds-muted,#6f7489)",
  display:"Inter, system-ui, sans-serif", body:"'Plus Jakarta Sans', system-ui, sans-serif",
};

/** P7: хойст — таб-бар ремаунтився на кожен рендер кокпіта. */
const Tab = ({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) => (
  <button onClick={onClick}
    style={{
      flex:1, height:44, border:"none", cursor:"pointer", background:"transparent",
      fontFamily:F.display, fontWeight:700, fontSize:15,
      color: active ? F.teal : F.muted,
      borderBottom: `2.5px solid ${active ? F.teal : "transparent"}`,
      display:"flex", alignItems:"center", justifyContent:"center", gap:5,
    }}>
    {label}
    {count !== undefined && count > 0 && (
      <span style={{ background:F.warn, color:"#fff", borderRadius:999, fontSize: 14,
        fontWeight:800, padding:"0 6px", height:18, display:"inline-flex", alignItems:"center" }}>
        {count}
      </span>
    )}
  </button>
);


/** M2: підсумки за рік неповні — кажемо це прямо, з точним числом. */
function TruncatedYearBanner({ n }: { n: { lessons: number; groups: number; tx: number } }) {
  const { t } = useTranslation();
  const worst = Math.max(n.lessons, n.groups, n.tx);
  return (
    <div role="status" className="mb-4 rounded-[14px] border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-[14px] font-semibold text-amber-900">{t("finances.truncatedTitle", { shown: 500, total: worst })}</p>
      <p className="mt-1 text-[14px] text-amber-900/85">{t("finances.truncatedBody")}</p>
    </div>
  );
}

export default function FinancesPage() {
  const { t } = useTranslation();
  const haptic = useHaptic();
  const { roles } = useAuth();
  const { isIndependent, loading: wsLoading, workspaceUnknown } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isIndependentTutor = isTutor && !isManager && isIndependent;
  // A HUB tutor is PAID a payout by the hub. They must NEVER see student_price, the
  // hub margin (student_price − tutor_payout), student→hub debt, the profit/margin
  // analytics, or mark student payments. They get a dedicated payout-only view below;
  // the leaking manager-style render is reserved for managers.
  const isHubTutor = isTutor && !isManager && !isIndependent;
  // P8: для хабового «Дохід/Борги» = «Виплачено/Не виплачено» (хаб-модель).
  const exportPaidKey = isHubTutor ? "exportKindPaidOut" : "exportKindPaid";
  const exportUnpaidKey = isHubTutor ? "exportKindNotPaidOut" : "exportKindDebts";
  const canManagePrepay = isManager || isIndependentTutor;
  const [studentFilter, setStudentFilter] = useState("all");
  // A8: одна гілка списку в DOM (моб. картки АБО десктоп-таблиця) + пагінація —
  // раніше при .limit(500) телефон тримав до 1000 піддерев одночасно.
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const [rowsShown, setRowsShown] = useState(100);
  const [reloadKey, setReloadKey] = useState(0); // B22: рефетч після позначення оплат
  const dataVersion = useDataVersion(); // C3

  const [searchParams, setSearchParams] = useSearchParams();

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // M2: три грошові запити мають .limit(500). Якщо за рік більше — підсумки
  // неповні, і людина МУСИТЬ це побачити, а не звіряти з банком і не вірити продукту.
  const [truncatedYear, setTruncatedYear] = useState<{ lessons: number; groups: number; tx: number } | null>(null);
  const [tutorFilter, setTutorFilter] = useState<string>("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportTutor, setExportTutor] = useState("all");
  const [exportKind, setExportKind] = useState<"all" | "paid" | "unpaid">("all");
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
  // Уніфікація флоу «+ Внести оплату» з дашборда менеджера: приходимо сюди з
  // ?record=1 і одразу відкриваємо ЄДИНУ нову форму (RecordPaymentSheet).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("record") === "1") {
      setRecordOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [balances, setBalances] = useState<Record<string, { lessons_balance: number; amount_balance: number }>>({});
  const [pairRates, setPairRates] = useState<Record<string, number | undefined>>({});
  // Per-pair billing currency (student_rates.currency) — RecordPaymentSheet must not
  // label USD/EUR students' amounts with a hardcoded ₴.
  const [pairCurrencies, setPairCurrencies] = useState<Record<string, string | undefined>>({});
  const [walletPair, setWalletPair] = useState<WalletPair | null>(null);
  // Видалення помилкової передоплати прямо зі стріму (RPC дозволяє лише менеджеру)
  const [deletePrepayTx, setDeletePrepayTx] = useState<WalletTransaction | null>(null);
  const [deletingPrepay, setDeletingPrepay] = useState(false);
  const confirmDeletePrepay = async () => {
    if (!deletePrepayTx) return;
    setDeletingPrepay(true);
    try {
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
          // H2: у БД — лише машинний маркер. Українське речення в note показувалось
          // потім БУДЬ-ЯКОЮ мовою; текст рендер бере з i18n за маркером.
          _note: `[storno:${deletePrepayTx.id}]`,
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
    } finally {
      setDeletingPrepay(false);
    }
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
    setRowsShown(100); // A8: нова вкладка — пагінація з початку
    const params = new URLSearchParams(searchParams);
    params.delete("filter");
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const fetchData = async () => {
    setLoading(true);
    // SECURITY (financial-data isolation): a HUB tutor must NEVER receive student_price /
    // student-payment columns — that is the HUB's revenue, and student_price − tutor_payout
    // is the hub's margin (the tutor only earns their agreed tutor_payout). Those columns
    // are GRANT-locked on lesson_details (migration 20260715000000), so individual-lesson
    // Money (individual AND group) is read through the masked definer views
    // (lessons_visible / lesson_participants_visible): manager + independent-owner
    // see it, a hub tutor gets NULL — enforced server-side, no per-role column lists.
    const [
      { data: lessonsData, error: lErr },
      { data: groupLessonsData, error: gErr },
      { data: txData, error: txErr },
      { data: balData, error: balErr },
      { data: ratesData, error: rErr },
    ] = await Promise.all([
      (async () => {
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        // Individual (non-group) lessons only — group lessons have student_id=NULL and are
        // pulled separately below. lessons_visible already hub-scopes managers (source
        // hub/NULL) and masks money per role.
        const run = (withFee: boolean) => {
          let q = supabase
            .from("lessons_visible")
            .select("id, subject, starts_at, status, student_id, tutor_id, source, duration_minutes, student_price, tutor_payout, student_payment_status, tutor_payout_status, student_paid_at, tutor_paid_at" + (withFee ? ", is_cancellation_fee" : "") as any)
            .not("student_id", "is", null)
            .gte("starts_at", oneYearAgo)
            .limit(500);
          if (isManager) q = (q as any).neq("source", "independent");
          return q.order("starts_at", { ascending: false });
        };
        // Migration 20260721000000 adds is_cancellation_fee to lessons_visible; until
        // Lovable applies it the column 400s — retry without it so Finances (frontend
        // ships first via Publish) never renders an empty money list.
        const res = await run(true);
        return res.error ? run(false) : res;
      })(),
      // GROUP lessons (lessons.student_id = NULL) are excluded from the individual query
      // above by `.not("student_id","is",null)`. Pull them separately, then attach the
      // per-student participants from the MASKED lesson_participants_visible view (the
      // base table's money columns are SELECT-revoked since 20260720000000, and a
      // PostgREST embed reads the base table — it would 42501 for everyone).
      (async () => {
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        let q = supabase
          .from("lessons")
          .select("id, subject, starts_at, status, tutor_id")
          .not("group_id", "is", null)
          .gte("starts_at", oneYearAgo)
          .limit(500);
        if (isManager) q = (q as any).neq("source", "independent");
        const { data: gl, error } = await q.order("starts_at", { ascending: false });
        if (error || !gl || gl.length === 0) return { data: gl ?? [], error };
        const { data: parts } = await (supabase.from("lesson_participants_visible" as any) as any)
          .select("id, lesson_id, student_id, student_price, student_payment_status, student_paid_at")
          .in("lesson_id", (gl as any[]).map((l) => l.id));
        const byLesson = new Map<string, any[]>();
        ((parts ?? []) as any[]).forEach((p) => {
          const arr = byLesson.get(p.lesson_id) ?? [];
          arr.push(p);
          byLesson.set(p.lesson_id, arr);
        });
        return { data: (gl as any[]).map((l) => ({ ...l, lesson_participants: byLesson.get(l.id) ?? [] })), error: null };
      })(),
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
        .select("tutor_id, student_id, price_per_lesson, currency, archived_at")
        .is("archived_at", null),
    ]);
    // Аудит 01.09: перевірявся лише перший запит, і навіть він лише тостом —
    // після невдалого читання екран малював «Прибуток 0 ₴» і «Оплат не знайдено»,
    // тобто помилка виглядала точно як «даних немає». Груповий дохід зникав тихо.
    if (lErr || gErr || txErr || balErr || rErr) {
      setLoadError(true);
      setLoading(false);
      return;
    }

    // M2: чесність підсумків — рахуємо, скільки рядків насправді за рік. Якщо
    // будь-який із трьох масивів уперся в 500, показуємо банер із точним N.
    {
      const oneYearAgoC = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const countInd = (() => {
        let q = supabase.from("lessons_visible").select("id", { count: "exact", head: true })
          .not("student_id", "is", null).gte("starts_at", oneYearAgoC);
        if (isManager) q = (q as any).neq("source", "independent");
        return q;
      })();
      const countGrp = (() => {
        let q = supabase.from("lessons").select("id", { count: "exact", head: true })
          .not("group_id", "is", null).gte("starts_at", oneYearAgoC);
        if (isManager) q = (q as any).neq("source", "independent");
        return q;
      })();
      const countTx = (supabase.from("student_wallet_transactions" as any) as any)
        .select("id", { count: "exact", head: true });
      const [ci, cg, ct] = await Promise.all([countInd, countGrp, countTx]);
      const n = { lessons: ci.count ?? 0, groups: cg.count ?? 0, tx: ct.count ?? 0 };
      const hit = (lessonsData?.length ?? 0) >= 500 || (groupLessonsData?.length ?? 0) >= 500 || (txData?.length ?? 0) >= 500;
      setTruncatedYear(hit && (n.lessons > 500 || n.groups > 500 || n.tx > 500) ? n : null);
    }

    // Fetch profiles for EVERY referenced user id (individual student/tutor +
    // GROUP participant student ids + wallet/rate pairs) via .in() — a blind
    // .limit(300) page silently dropped group participants, so their name showed "—".
    const profileIds = new Set<string>();
    ((lessonsData ?? []) as any[]).forEach((l) => {
      if (l.student_id) profileIds.add(l.student_id);
      if (l.tutor_id) profileIds.add(l.tutor_id);
    });
    ((groupLessonsData ?? []) as any[]).forEach((l) => {
      if (l.tutor_id) profileIds.add(l.tutor_id);
      ((l.lesson_participants ?? []) as any[]).forEach((p) => {
        if (p.student_id) profileIds.add(p.student_id);
      });
    });
    ((txData ?? []) as any[]).forEach((tx) => {
      if (tx.tutor_id) profileIds.add(tx.tutor_id);
      if (tx.student_id) profileIds.add(tx.student_id);
    });
    ((balData ?? []) as any[]).forEach((b) => {
      if (b.tutor_id) profileIds.add(b.tutor_id);
      if (b.student_id) profileIds.add(b.student_id);
    });
    ((ratesData ?? []) as any[]).forEach((r) => {
      if (r.tutor_id) profileIds.add(r.tutor_id);
      if (r.student_id) profileIds.add(r.student_id);
    });
    const idList = Array.from(profileIds);
    // Chunk to stay well under URL/`in` limits on large hubs.
    const CHUNK = 200;
    const profileChunks = await Promise.all(
      Array.from({ length: Math.ceil(idList.length / CHUNK) }, (_, i) =>
        supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", idList.slice(i * CHUNK, (i + 1) * CHUNK)),
      ),
    );
    const profilesData = profileChunks.flatMap((c) => c.data ?? []);
    if (profileChunks.some((c) => c.error)) toast.error(t("finances.loadProfilesError"));
    const mapped: LessonRow[] = ((lessonsData ?? []) as any[]).map((l) => ({
      id: l.id,
      subject: l.subject,
      starts_at: l.starts_at,
      status: l.status,
      is_cancellation_fee: l.is_cancellation_fee === true,
      student_id: l.student_id,
      tutor_id: l.tutor_id,
      student_price: Number(l.student_price ?? 0),
      tutor_payout: Number(l.tutor_payout ?? 0),
      student_payment_status: (l.student_payment_status ?? "unpaid") as PaymentStatus,
      tutor_payout_status: (l.tutor_payout_status ?? "unpaid") as PaymentStatus,
      student_paid_at: l.student_paid_at ?? null,
      tutor_paid_at: l.tutor_paid_at ?? null,
      duration_minutes: Number(l.duration_minutes ?? 60),
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
        is_group: true,
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
    const currencyMap: Record<string, string | undefined> = {};
    ((ratesData ?? []) as any[]).forEach((r) => {
      rateMap[`${r.tutor_id}:${r.student_id}`] = Number(r.price_per_lesson ?? 0) || undefined;
      if (r.currency) currencyMap[`${r.tutor_id}:${r.student_id}`] = r.currency;
    });
    setPairRates(rateMap);
    setPairCurrencies(currencyMap);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [reloadKey, dataVersion]);

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
    // Shared predicate (src/lib/financials) — Dashboard uses the same one, so the
    // two pages can no longer drift and show different profit for the same data.
    const nowMs = Date.now();
    return tutorScoped.filter((l) => isBillableLesson(l, nowMs));
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

  // PREPAYMENT model: debts are computed over ALL period rows (incl. FUTURE
  // unpaid lessons — hub students pay before lessons), not only billable ones.
  // DEBT INVARIANT (10.08): борг — величина БЕЗ періоду. Фільтр місяця керує
  // оборотами, але дебіторка не «зникає» при зміні періоду — саме через
  // inPeriod тут картка розходилась із телеграм-дайджестом.
  const periodStudentDebts = useMemo(
    () => tutorScoped.filter((l) => isStudentDebtLesson(l)),
    [tutorScoped],
  );
  // Payouts owed: CONDUCTED lessons only — mirrors mark_tutor_payouts_paid, so
  // the sums here always equal what the pay actions actually flip.
  const periodPayoutDue = useMemo(() => {
    const nowMs = Date.now();
    return tutorScoped.filter((l) => isPayoutDueLesson(l, nowMs));
  }, [tutorScoped]);

  /** H2: нотатка транзакції — маркер → переклад; старі укр-нотатки (до 03.09) показуємо як є. */
  const noteLabel = (note: string): string => {
    const m = /^\[storno:[0-9a-fA-F-]+\]\s*(.*)$/.exec(note);
    if (!m) return note;
    return m[1].trim() ? m[1].trim() : t("finances.stornoNote");
  };
  const stornoedIds = useMemo(() => {
    const ids = new Set<string>();
    transactions.forEach((tx) => {
      const m = /\[storno:([0-9a-fA-F-]+)\]/.exec(tx.note ?? "");
      if (m) ids.add(m[1]);
    });
    return ids;
  }, [transactions]);

  // Legit HUB pairs the caller may see money for: hub-scoped rates (managers get
  // only hub rates via RLS) + hub-visible lessons (lessons_visible is source-scoped).
  // A wallet tx for a pair NOT in here belongs to an independent tutor and must be
  // hidden from the manager (defence-in-depth alongside the RLS fix).
  const hubPairKeys = useMemo(() => {
    const keys = new Set<string>(Object.keys(pairRates));
    lessons.forEach((l) => { if (l.student_id) keys.add(`${l.tutor_id}:${l.student_id}`); });
    return keys;
  }, [pairRates, lessons]);

  const periodTopups = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          // Сторновані пари ховаємо: і компенсуючий запис, і скасований оригінал
          !/\[storno:/.test(tx.note ?? "") &&
          !stornoedIds.has(tx.id) &&
          (tx.kind === "topup" || tx.lessons_delta > 0 || Number(tx.amount_delta) > 0)
          && (tutorFilter === "all" || tx.tutor_id === tutorFilter)
          // Managers: only HUB wallets (an independent tutor's student wallet must
          // not appear on the hub's Finances — isolation).
          && (!isManager || hubPairKeys.has(`${tx.tutor_id}:${tx.student_id}`))
          && inPeriod(tx.created_at),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, tutorFilter, periodStart, stornoedIds, isManager, hubPairKeys],
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
    // Period-scoped by lesson date — kept identical to the summary total / CSV / chart
    // (which all derive from periodBillable) so the list and the headline number agree.
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
    // Student debts (incl. future unpaid — prepayment) + payout debts (conducted only).
    const ids = new Set<string>();
    const rows: LessonRow[] = [];
    periodStudentDebts.forEach((l) => { if (!ids.has(l.id)) { ids.add(l.id); rows.push(l); } });
    if (!isIndependentTutor)
      periodPayoutDue.forEach((l) => { if (!ids.has(l.id)) { ids.add(l.id); rows.push(l); } });
    return rows.map((l) => ({ type: "lesson" as const, l })).sort(activeSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodStudentDebts, periodPayoutDue, isIndependentTutor, sort]);

  const rowsForActiveTab: Row[] =
    activeTab === "income" ? incomeRows : debtsRows;

  const visibleLessons: LessonRow[] = useMemo(
    () => rowsForActiveTab.filter((r): r is { type: "lesson"; l: LessonRow } => r.type === "lesson").map((r) => r.l),
    [rowsForActiveTab],
  );

  // Sticky-summary totals — derived from `periodBillable` via the shared MON-2
  // money math (src/lib/financials, locked by financials.test.ts)…
  const arrIncome = paidIncome(periodBillable);
  const arrExpense = paidExpense(periodBillable);

  // …АЛЕ масиви обрізані на 500 рядках (M2). Правильне число рахує база:
  // finances_period_totals читає lessons_visible як SECURITY INVOKER, тож
  // маскування за персоною успадковане, а семантика — та сама isBillableLesson.
  // Поки міграція не застосована (RPC відсутня) — масиви; коли є — база, і
  // розбіжність із масивами показується як розбіжність, не ховається.
  type DbTotals = { paid_income: number; paid_expense: number; markup_income: number; markup_payout: number; billable_count: number; income_by_currency: Record<string, number> };
  const [dbTotals, setDbTotals] = useState<DbTotals | null>(null);
  useEffect(() => {
    if (loading || loadError) return;
    let alive = true;
    (async () => {
      const fromIso = new Date(periodStart || 0).toISOString();
      const { data, error } = await (supabase.rpc as any)("finances_period_totals", {
        _from: fromIso, _tutor: tutorFilter === "all" ? null : tutorFilter,
      });
      if (!alive) return;
      if (error || !data) { setDbTotals(null); return; } // функція ще не в проді
      const d = data as DbTotals;
      setDbTotals({
        paid_income: Number(d.paid_income ?? 0), paid_expense: Number(d.paid_expense ?? 0),
        markup_income: Number(d.markup_income ?? 0), markup_payout: Number(d.markup_payout ?? 0),
        billable_count: Number(d.billable_count ?? 0),
        income_by_currency: (d.income_by_currency as Record<string, number>) ?? {},
      });
    })();
    return () => { alive = false; };
  }, [loading, loadError, periodStart, tutorFilter]);

  const totalIncome = dbTotals ? dbTotals.paid_income : arrIncome;
  const totalExpense = dbTotals ? dbTotals.paid_expense : arrExpense;
  const profit = totalIncome - totalExpense;
  // Коли масив НЕ обрізаний, база і масив мусять збігатися. Якщо ні — це
  // дефект семантики (SQL ≠ TS), і ми хочемо його БАЧИТИ, а не отримати тихо.
  const totalsParity = dbTotals && !truncatedYear
    ? Math.abs(dbTotals.paid_income - arrIncome) <= 1 && Math.abs(dbTotals.paid_expense - arrExpense) <= 1
    : null;
  const pendingIncome = periodStudentDebts.reduce((sum, l) => sum + Number(l.student_price ?? 0), 0);
  const pendingExpense = periodPayoutDue.reduce((sum, l) => sum + Number(l.tutor_payout ?? 0), 0);
  const totalDebt = pendingIncome + (isIndependentTutor ? 0 : pendingExpense);

  // САМОЗВІРКА (замість ручних SQL-звірок власниці): раз на завантаження
  // питаємо канонічну SQL-функцію і порівнюємо з клієнтським підрахунком.
  // Розбіжність > 1 ₴ → жовтий бейдж ⚠️ з обома числами.
  const [parity, setParity] = useState<null | { ok: boolean; db: number; app: number }>(null);
  useEffect(() => {
    if (!isManager || loading) return;
    (async () => {
      const { data, error } = await (supabase.rpc as any)("manager_debts_summary");
      if (error || !data) return; // функція ще не застосована — бейдж просто не показуємо
      const row = Array.isArray(data) ? data[0] : data;
      const db = Number(row?.students_debt ?? 0) + Number(row?.payouts_owed ?? 0);
      setParity({ ok: Math.abs(db - totalDebt) <= 1, db, app: totalDebt });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, loading, totalDebt]);

  // === Analytics (unchanged) — use full `billable` so trends are stable regardless of period selection. ===
  const hubMarkup = useMemo(() => {
    // M2: націнка з бази, коли є (та сама умова price>0 AND payout>0 у SQL).
    if (dbTotals && dbTotals.markup_income > 0) {
      return ((dbTotals.markup_income - dbTotals.markup_payout) / dbTotals.markup_income) * 100;
    }
    return grossMarkupPct(billable);
  }, [billable, dbTotals]);

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
        markup: grossMarkupPct(rows),
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
    const curs = new Map<string, string>();
    billable
      .filter((l) => l.student_payment_status === "paid" && Number(l.student_price) > 0)
      .forEach((l) => {
        map.set(l.student_id, (map.get(l.student_id) ?? 0) + Number(l.student_price));
        if (!curs.has(l.student_id))
          curs.set(l.student_id, (l as any).currency ?? pairCurrencies[`${l.tutor_id}:${l.student_id}`] ?? "UAH");
      });
    const all = Array.from(map.entries())
      .map(([student_id, amount]) => ({ student_id, name: nameOf(student_id), amount, cur: curs.get(student_id) ?? "UAH" }))
      .sort((a, b) => b.amount - a.amount);
    // P0.8: сектори — ТІЛЬКИ домінантна валюта; площі від чесної суми.
    const byCur = new Map<string, number>();
    all.forEach((r) => byCur.set(r.cur, (byCur.get(r.cur) ?? 0) + r.amount));
    const dom = [...byCur.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UAH";
    const rows = all.filter((r) => r.cur === dom);
    const TOP = 6;
    if (rows.length <= TOP) return rows;
    const head = rows.slice(0, TOP);
    const tail = rows.slice(TOP);
    const other = tail.reduce((s, r) => s + r.amount, 0);
    return [...head, { student_id: "__other__", name: t("finances.others", { count: tail.length }), amount: other, cur: tail[0]?.cur ?? "UAH" }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable, profiles, pairCurrencies]);

  const pairsList = useMemo<PairOption[]>(() => {
    const keys = new Set<string>();
    lessons.forEach((l) => { if (l.student_id) keys.add(`${l.tutor_id}:${l.student_id}`); });
    Object.keys(pairRates).forEach((key) => keys.add(key));
    // transactions + balances can carry independent-tutor pairs (leaked before the
    // wallet-tx RLS fix) — for a manager, admit them only if they're a known hub pair.
    const admit = (key: string) => !isManager || hubPairKeys.has(key);
    transactions.forEach((tx) => { const k = `${tx.tutor_id}:${tx.student_id}`; if (admit(k)) keys.add(k); });
    Object.keys(balances).forEach((key) => { if (admit(key)) keys.add(key); });
    return Array.from(keys).map((key) => {
      const [tutor_id, student_id] = key.split(":");
      return {
        tutor_id,
        student_id,
        tutor_name: nameOf(tutor_id),
        student_name: nameOf(student_id),
        rate: pairRates[key],
        currency: pairCurrencies[key],
      };
    }).sort((a, b) => a.student_name.localeCompare(b.student_name, "uk"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, transactions, balances, pairRates, profiles]);

  // 💳 «Передоплати учнів» для менеджера: станом на зараз, лише додатні залишки.
  // Джерело — той самий balances (student_wallet_balances) і pairsList (hub-скоуп
  // уже застосований), тож цифра тут = цифрі в гаманці пари, без другої правди.
  const prepaidRows = useMemo(() => {
    return pairsList
      .map((p) => {
        const b = balances[`${p.tutor_id}:${p.student_id}`];
        return b ? { ...p, lessons: b.lessons_balance || 0, amount: b.amount_balance || 0 } : null;
      })
      .filter((r): r is NonNullable<typeof r> => !!r && (r.lessons > 0 || r.amount > 0))
      .sort((a, b) => a.student_name.localeCompare(b.student_name, "uk"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsList, balances]);

  const unpaidLessonsForSheet = useMemo<UnpaidLessonOption[]>(() =>
    // Prepayment model: recording a payment against an UPCOMING lesson is the
    // normal flow, so the picker offers every student-debt row (not only past).
    tutorScoped
      .filter((l) => isStudentDebtLesson(l))
      .map((l) => ({
        id: l.id,
        subject: l.subject,
        starts_at: l.starts_at,
        student_price: Number(l.student_price),
        student_id: l.student_id,
        tutor_id: l.tutor_id,
        currency: pairCurrencies[`${l.tutor_id}:${l.student_id}`],
      })),
    [tutorScoped, pairCurrencies]
  );

  // === Mutations (logic unchanged) ===
  // Route a student-payment write to the correct table: individual lessons keep it on
  // lesson_details (keyed by lesson_id; student_paid_at is auto-stamped INSIDE
  // update_lesson_details_safe on the unpaid→paid transition — migration 20260703000000,
  // NOT a trigger); group participants store it per-row on lesson_participants.
  const writeStudentPayment = (lesson: LessonRow, status: PaymentStatus, paidAt: string | null) =>
    lesson.kind === "group"
      ? // Gated RPC (hub-scoped manager OR independent owner) — direct column
        // UPDATE on lesson_participants is revoked since 20260719000000.
        (supabase.rpc as any)("set_group_participant_payment", {
          _participant_ids: [lesson.participant_id ?? ""],
          _status: status,
        })
      : updateLessonDetailsSafe(lesson.id, { student_payment_status: status });

  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindingAll, setRemindingAll] = useState(false); // B5: анти-дубль масової розсилки
  // Send a REAL payment reminder (email / Telegram) via the remind-payment edge
  // function — the same notify path the payment reminders use, so the student actually gets it.
  const remindLesson = async (lessonId: string, studentId: string) => {
    setRemindingId(lessonId);
    const { data, error } = await supabase.functions.invoke("remind-payment", { body: { lessonId } });
    setRemindingId(null);
    if (error) {
      // A non-2xx (404 lesson-not-found, 409 already-paid, transport, …) — NOT a
      // missing-contact case, so don't blame the student's contact details.
      toast.error(t("pendingPaymentsExtra.reminderGeneric"));
      return;
    }
    if ((data as any)?.success) {
      const channels = ((data as any).channels ?? []) as string[];
      const labels = channels.map((c) => (c === "telegram" ? "Telegram" : "email"));
      toast.success(t("pendingPayments.reminderSent", { labels: labels.join(" + ") || "email" }), { description: nameOf(studentId) });
    } else if ((data as any)?.reason === "no_channels") {
      // The function explicitly reported the student has neither Telegram nor email.
      toast.error(t("pendingPaymentsExtra.noContact"), { description: nameOf(studentId) });
    } else {
      toast.error(t("pendingPaymentsExtra.reminderGeneric"));
    }
  };

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
    // Instant felt feedback BEFORE the DB round-trip (binding invariant — the tap must
    // be felt/seen immediately, not after a ~1-2s await). Reverted below on error.
    if (next === "paid") haptic.success(); else haptic.tap();

    const { error } =
      field === "student_payment_status"
        ? await writeStudentPayment(lesson, next, nextPaidAt)
        : await supabase.rpc("set_lesson_tutor_payout_status", { _lesson_id: lesson.id, _status: next });
    if (!error) { setReloadKey((k) => k + 1); logEvent("payment_marked", { page: "finances" }); bumpDataVersion(); } // B22+C6+C3
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
    // Payout side: tell the tutor they've been paid — this toggle was the silent
    // sibling of DashboardPage.updatePayment (the only payout_confirmed producer).
    if (field === "tutor_payout_status" && next === "paid" && lesson.tutor_id) {
      insertNotification({
        userId: lesson.tutor_id,
        type: `payout_confirmed_${lesson.id}`,
        title: t("notifications.payoutConfirmedTitle", { amount: formatPrice(Number(lesson.tutor_payout ?? 0), "UAH") }),
        link: "/finances",
      });
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
        // B3: відкат по «Скасувати» в тості теж пише в БД — і теж може впасти.
        // Раніше екран показував «не оплачено», а в базі лишалось «оплачено».
        const res =
          field === "student_payment_status"
            ? await writeStudentPayment(lesson, lesson.student_payment_status, lesson.student_paid_at)
            : await supabase.rpc("set_lesson_tutor_payout_status", { _lesson_id: lesson.id, _status: lesson.tutor_payout_status });
        if ((res as { error?: unknown } | null)?.error) {
          toast.error(t("dashboardExtra.paymentFailed"));
          setReloadKey((k) => k + 1); // екран повертається до правди БД
        }
      };
      // Money IN (student paid the hub) is the manager's most rewarding beat —
      // give it the same warm "💰 +amount from {name}!" toast as the Dashboard,
      // not a cold "✓ marked". Payout OUT stays a calm confirmation.
      const warm = field === "student_payment_status";
      toast.success(
        warm
          ? t("dashboardExtra.paymentReceivedToast", {
              amount: formatPrice(Number(lesson.student_price), rowCurrency(lesson)),
              name: nameOf(lesson.student_id),
            })
          : t("finances.markedAsPayout"),
        {
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
    /* Аудит 03.09: «вибрати все» бере до 100 видимих рядків, і один тап
       переводив їх усі в «оплачено» з конфеті — без діалогу і без undo.
       Це запис у гроші; він мусить питати. */
    {
      const ok = await confirmDialog({
        title: t("finances.bulkMarkConfirmTitle", { count: selected.size }),
        description: field === "student_payment_status"
          ? t("finances.bulkMarkConfirmDescStudent")
          : t("finances.bulkMarkConfirmDescPayout"),
        confirmText: t("finances.bulkMarkConfirmBtn"),
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
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
      haptic.success(); // instant felt feedback before the DB round-trip (reverted on error)
      // B4: збираємо невдалі ПОІМЕННО — відкат лише їх, а не всіх 50 разом із
      // 40 успішно записаними (раніше setLessons(previousLessons) «розписував»
      // назад і те, що в БД уже стояло як оплачене).
      const failedRowKeys = new Set<string>();
      const rowKey = (l: LessonRow) => `${l.id}:${(l as any).participant_id ?? ""}`;
      if (field === "student_payment_status") {
        const indRows = selRows.filter((l) => l.kind !== "group");
        const grpRows = selRows.filter((l) => l.kind === "group");
        const grpIds = grpRows.map((l) => l.participant_id!).filter(Boolean);
        const [indRes, grpRes] = await Promise.all([
          updateLessonDetailsSafeEach(indRows.map((l) => l.id), { student_payment_status: "paid" as PaymentStatus }),
          grpIds.length
            ? (supabase.rpc as any)("set_group_participant_payment", { _participant_ids: grpIds, _status: "paid" })
            : Promise.resolve({ error: null }),
        ]);
        const failedInd = new Set(indRes.failedIds);
        indRows.forEach((l) => { if (failedInd.has(l.id)) failedRowKeys.add(rowKey(l)); });
        // Груповий RPC — один виклик на всіх: якщо впав, невдалі всі групові рядки.
        if ((grpRes as { error?: unknown }).error) grpRows.forEach((l) => failedRowKeys.add(rowKey(l)));
      } else {
        const indRows = selRows.filter((l) => l.kind !== "group");
        const res = indRows.length
          ? await supabase.rpc("set_lesson_tutor_payout_status_bulk", { _lesson_ids: indRows.map((l) => l.id), _status: "paid" })
          : { error: null };
        // Bulk-RPC атомарний: помилка = не записалось нічого з індивідуальних.
        if ((res as { error?: unknown }).error) indRows.forEach((l) => failedRowKeys.add(rowKey(l)));
      }
      setBulkBusy(false);
      if (failedRowKeys.size > 0) {
        haptic.error();
        // Відкат лише невдалих рядків до попереднього стану.
        setLessons((prev) =>
          prev.map((l) => {
            if (!failedRowKeys.has(rowKey(l))) return l;
            return previousLessons.find((p) => rowKey(p) === rowKey(l)) ?? l;
          })
        );
        const okCount = selRows.length - failedRowKeys.size;
        if (okCount > 0) {
          toast.error(t("finances.bulkPartialFailed", { ok: okCount, failed: failedRowKeys.size }));
        } else {
          toast.error(t("finances.bulkUpdateFailed"));
        }
        // Невдалі лишаються виділеними — повторити можна одним тапом.
        setSelected(new Set(selRows.filter((l) => failedRowKeys.has(rowKey(l))).map((l) => l.id)));
        return;
      }
      // Clearing a whole debt list at once is a real win — celebrate it (haptic already
      // fired instantly above; confetti is the after-success bonus).
      if (field === "student_payment_status") burstConfetti();
      // Report only what was actually WRITTEN: a payout bulk deliberately skips group
      // rows (no payout side exists), so counting the full selection over-reported.
      const writtenCount =
        field === "student_payment_status"
          ? selRows.length
          : selRows.filter((l) => l.kind !== "group").length;
      const skippedGroups = ids.length - writtenCount;
      if (writtenCount > 0) {
        toast.success(t("finances.bulkUpdated", { count: writtenCount }), {
          description: skippedGroups > 0 ? t("finances.bulkSkippedGroup", { count: skippedGroups }) : undefined,
        });
      } else {
        toast.info(t("finances.bulkSkippedGroup", { count: skippedGroups }));
      }
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const exportCsv = (opts?: { tutorId?: string; kind?: "all" | "paid" | "unpaid" }) => {
    // The CSV must match what each role is allowed to see on screen:
    //  - independent tutor: student-billing only, NO payout/profit (no hub margin exists);
    //  - hub tutor: their PAYOUT only, NO student_price / student-payment / profit (margin);
    //  - manager: everything.
    const header = [
      t("finances.csvDate"),
      t("finances.csvSubject"),
      t("finances.csvStudent"),
      ...(!isHubTutor
        ? [
            t("finances.csvStudentPrice"),
            t("finances.csvStudentPayStatus"),
            t("finances.csvStudentPaidAt"),
          ]
        : []),
      ...(!isIndependentTutor
        ? [
            t("finances.csvTutor"),
            t("finances.csvPayout"),
            t("finances.csvPayoutStatus"),
            t("finances.csvPayoutAt"),
          ]
        : []),
      ...(!isIndependentTutor && !isHubTutor ? [t("finances.csvProfit")] : []),
    ];
    // Export the selected period (every tab), optionally narrowed by the export
    // dialog (tutor + paid/unpaid). Was the active-tab subset, which dropped rows.
    const tId = opts?.tutorId && opts.tutorId !== "all" ? opts.tutorId : null;
    const kind = opts?.kind ?? "all";
    // For a hub tutor the paid/unpaid filter follows THEIR payout status, not the
    // student's (whose status they can't see).
    const kindStatusOf = (l: LessonRow) =>
      isHubTutor ? l.tutor_payout_status : l.student_payment_status;
    // Union billable rows with prepay debts so «неоплачені» exports include
    // FUTURE unpaid lessons — same set the Debts tab shows.
    const seenIds = new Set<string>();
    const exportRows: LessonRow[] = [];
    [...periodBillable, ...periodStudentDebts].forEach((l) => {
      if (!seenIds.has(l.id)) { seenIds.add(l.id); exportRows.push(l); }
    });
    const source = exportRows.filter((l) => {
      if (tId && l.tutor_id !== tId) return false;
      if (kind === "paid" && kindStatusOf(l) !== "paid") return false;
      if (kind === "unpaid" && kindStatusOf(l) !== "unpaid") return false;
      return true;
    });
    const rows = source.map((l) => [
      formatDate(l.starts_at),
      l.subject,
      nameOf(l.student_id),
      ...(!isHubTutor
        ? [
            String(l.student_price),
            l.student_payment_status === "paid" ? t("finances.csvPaid") : t("finances.csvPending"),
            l.student_paid_at ? formatDate(l.student_paid_at) : "",
          ]
        : []),
      ...(!isIndependentTutor
        ? [
            nameOf(l.tutor_id),
            // Group rows: no payout is tracked (payout=0 / status="paid" are
            // synthetic) — export "—" like the on-screen table, not fake money.
            l.kind === "group" ? "—" : String(l.tutor_payout),
            l.kind === "group" ? "—" : l.tutor_payout_status === "paid" ? t("finances.csvPaidOut") : t("finances.csvPending"),
            l.kind === "group" ? "" : l.tutor_paid_at ? formatDate(l.tutor_paid_at) : "",
          ]
        : []),
      ...(!isIndependentTutor && !isHubTutor
        ? [l.kind === "group" ? "—" : String(Number(l.student_price) - Number(l.tutor_payout))]
        : []),
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
            actionLabel={null}
          />
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Mobile sort controls */}
        <div className="flex items-center gap-1 border-b border-border bg-secondary/30 px-2 py-2 text-[14px] lg:hidden">
          <span className="mr-1 text-muted-foreground">{t("finances.sortBy")}</span>
          <MobileSortChip
            label={t("finances.colDate")}
            active={sort?.key === "starts_at" ? sort.dir : null}
            onClick={() => cycleSort("starts_at")}
          />
          <MobileSortChip
            label={t("finances.sortPaidShort")}
            active={sort?.key === "student_paid_at" ? sort.dir : null}
            onClick={() => cycleSort("student_paid_at")}
          />
          {!isIndependentTutor && (
            <MobileSortChip
              label={t("finances.sortPayoutShort")}
              active={sort?.key === "tutor_paid_at" ? sort.dir : null}
              onClick={() => cycleSort("tutor_paid_at")}
            />
          )}
        </div>
        {/* Mobile cards — A8: рендеримо ЛИШЕ активну гілку (раніше обидві жили
            в DOM постійно, до 1000 піддерев на телефоні при .limit(500)) */}
        {!isLgUp && (
        <div className="divide-y divide-border lg:hidden">
          {rows.slice(0, rowsShown).map((row) => {
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
                      <p className="text-[14px] text-muted-foreground">
                        {formatDate(tx.created_at)} · {nameOf(tx.student_id)} ↔ {nameOf(tx.tutor_id)}
                      </p>
                      {tx.note && (
                        <p className="mt-0.5 truncate text-[14px] text-muted-foreground">{noteLabel(tx.note)}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right text-sm font-semibold text-primary tabular-nums">
                        {tx.lessons_delta > 0 && <div>+{tx.lessons_delta} {t("finances.lessonsUnit")}</div>}
                        {Number(tx.amount_delta) > 0 && <div>+{formatPrice(Number(tx.amount_delta), pairCurrencies[`${tx.tutor_id}:${tx.student_id}`] ?? "UAH")}</div>}
                      </div>
                      {isManager && (
                        <span
                          role="button"
                          // C2: role="button" без tabIndex — скрінрідер каже «кнопка»,
                          // а сфокусувати неможливо; Enter/Space тепер працюють.
                          tabIndex={0}
                          aria-label={t("finances.deletePrepayAria")}
                          onClick={(e) => { e.stopPropagation(); setDeletePrepayTx(tx); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setDeletePrepayTx(tx); } }}
                          style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center",
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
                    <p className="flex items-center gap-1.5 truncate" style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: "var(--ds-txt,#0f0f1a)" }}>
                      <span className="truncate">{l.subject}</span>
                      {isGroup && <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: "#1f8e7e", background: "rgba(43,191,170,.12)", borderRadius: 7, padding: "1px 7px" }}>{t("finances.groupTag")}</span>}
                      {(l as any).is_cancellation_fee && <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: "#b4740b", background: "rgba(245,158,11,.14)", borderRadius: 7, padding: "1px 7px" }}>{t("finances.cancellationFeeTag")}</span>}
                    </p>
                    <p className="text-[14px]" style={{ color: "var(--sub,#666b82)", marginTop: 1 }}>{formatDate(l.starts_at)}</p>
                  </div>
                  {!isIndependentTutor && !isGroup && (
                    <div
                      className={`text-right shrink-0 font-semibold ${
                        lessonProfit >= 0 ? "text-foreground" : "text-destructive"
                      }`}
                      style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15 }}
                    >
                      {rowCurrency(l) === "UAH" ? formatPrice(lessonProfit, "UAH") : <span title={t("finances.mixedCurrencyProfit")}>—</span>}
                    </div>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 text-[14px]">
                  <div className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5",
                    studentUnpaid ? "bg-warning/10" : "bg-success/5",
                  )}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{nameOf(l.student_id)}</p>
                      {l.student_paid_at && (
                        <p className="truncate text-[14px] text-muted-foreground">
                          {t("finances.paidDate")} {formatDate(l.student_paid_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn(
                        "text-sm font-semibold",
                        studentUnpaid ? "text-warning" : "text-success",
                      )}>+{formatPrice(Number(l.student_price), rowCurrency(l))}</span>
                      <button
                        onClick={() => togglePayment(l, "student_payment_status")}
                        aria-label={t("finances.statusPaid")}
                      >
                        <Badge
                          className={
                            l.student_payment_status === "paid"
                              ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[14px]"
                              : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[14px]"
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
                          <p className="truncate text-[14px] text-muted-foreground">
                            {t("finances.payoutDate")} {formatDate(l.tutor_paid_at)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          "text-sm font-semibold",
                          tutorUnpaid ? "text-warning" : "text-foreground",
                        )}>-{formatPrice(Number(l.tutor_payout), "UAH")}</span>
                        <button
                          onClick={() => togglePayment(l, "tutor_payout_status")}
                          aria-label={t("finances.statusPaidOut")}
                        >
                          <Badge
                            className={
                              l.tutor_payout_status === "paid"
                                ? "bg-success/15 text-success border-0 hover:bg-success/25 cursor-pointer text-[14px]"
                                : "bg-warning/15 text-warning border-0 hover:bg-warning/25 cursor-pointer text-[14px]"
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
        )}

        {/* Desktop table — A8: лише коли активний брейкпоінт */}
        {isLgUp && (
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
                    sublabel={t("finances.sortByLessonDate")}
                    active={sort?.key === "starts_at" ? sort.dir : null}
                    onClick={() => cycleSort("starts_at")}
                    title={t("finances.sortByLessonDate")}
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colLesson")}</th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">{t("finances.colStudent")}</th>
                <th className="px-3 py-3 text-right font-medium text-success">
                  <SortHeader
                    align="right"
                    label={t("finances.colIncome")}
                    sublabel={t("finances.sortByPaidDateShort")}
                    active={sort?.key === "student_paid_at" ? sort.dir : null}
                    onClick={() => cycleSort("student_paid_at")}
                    title={t("finances.sortByPaidDate")}
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
                      sublabel={t("finances.sortByPayoutDateShort")}
                      active={sort?.key === "tutor_paid_at" ? sort.dir : null}
                      onClick={() => cycleSort("tutor_paid_at")}
                      title={t("finances.sortByPayoutDate")}
                    />
                  </th>
                )}
                {!isIndependentTutor && (
                  <th className="px-3 py-3 text-right font-medium text-muted-foreground">{t("finances.colProfit")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, rowsShown).map((row) => {
                if (row.type === "prepay") {
                  const tx = row.tx;
                  return (
                    <tr
                      key={`p-${tx.id}`}
                      className="border-b border-border last:border-0 bg-primary/[0.04] hover:bg-primary/10 cursor-pointer"
                      onClick={() => openWalletForPair(tx.tutor_id, tx.student_id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openWalletForPair(tx.tutor_id, tx.student_id); } }}
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
                            <span className="truncate text-[14px] text-muted-foreground">— {tx.note}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <div className="text-right font-semibold text-primary tabular-nums">
                            {tx.lessons_delta > 0 && <div>+{tx.lessons_delta} {t("finances.lessonsUnit")}</div>}
                            {Number(tx.amount_delta) > 0 && <div>+{formatPrice(Number(tx.amount_delta), pairCurrencies[`${tx.tutor_id}:${tx.student_id}`] ?? "UAH")}</div>}
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
                        {isGroup && <span style={{ fontSize: 14, fontWeight: 700, color: "#1f8e7e", background: "rgba(43,191,170,.12)", borderRadius: 7, padding: "1px 7px" }}>{t("finances.groupTag")}</span>}
                        {(l as any).is_cancellation_fee && <span style={{ fontSize: 14, fontWeight: 700, color: "#b4740b", background: "rgba(245,158,11,.14)", borderRadius: 7, padding: "1px 7px" }}>{t("finances.cancellationFeeTag")}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{nameOf(l.student_id)}</div>
                      {l.student_paid_at && (
                        <div className="text-[14px] text-muted-foreground">
                          {t("finances.paidDate")} {formatDate(l.student_paid_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className={cn(
                        "font-semibold",
                        studentUnpaid ? "text-warning" : "text-success",
                      )}>+{formatPrice(Number(l.student_price), rowCurrency(l))}</div>
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
                          <div className="text-[14px] text-muted-foreground">
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
                            )}>-{formatPrice(Number(l.tutor_payout), "UAH")}</div>
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
                        {isGroup ? (<span className="text-muted-foreground">—</span>) : rowCurrency(l) === "UAH" ? (formatPrice(lessonProfit, "UAH")) : (<span title={t("finances.mixedCurrencyProfit")}>—</span>)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        {/* A8: пагінація — DOM тримає до rowsShown рядків, решта за кнопкою */}
        {rows.length > rowsShown && (
          <div className="border-t border-border p-3 text-center">
            <button
              type="button"
              onClick={() => setRowsShown((n) => n + 100)}
              className="h-11 rounded-[12px] px-5 text-[14px] font-semibold text-primary hover:bg-primary/5"
            >
              {t("finances.showMoreRows", { count: rows.length - rowsShown })}
            </button>
          </div>
        )}
      </div>
    );
  };

  const periodLabel =
    period === "week"
      ? t("finances.periodWeek")
      : period === "month"
      ? t("finances.periodMonth")
      : t("finances.periodAll");


  // ── Independent Tutor Cockpit computed values ─────────────────────────────
  const [finTab, setFinTab] = useState<"ops"|"debts"|"analytics">("ops");
  const finTabsRef = useRef<HTMLDivElement | null>(null);
  const goTab = (id: "ops"|"debts"|"analytics") => {
    setFinTab(id);
    // Бульбашка зверху → одразу показуємо відповідну секцію.
    requestAnimationFrame(() => finTabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

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


  // Debt list (prepayment model): every unpaid priced lesson — future ones too.
  const debtList = useMemo(() =>
    periodStudentDebts
      .slice()
      .sort((a,b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [periodStudentDebts]);

  const paidLessonsCount = periodBillable.filter(l => l.student_payment_status === "paid").length;

  // Multi-currency (independent tutors bill in up to 5 currencies): summing mixed
  // currencies into one «₴» number misstates the money. Group per currency; the
  // dominant one headlines a card, the rest render as a compact "+ …" line.
  const rowCurrency = (l: LessonRow) =>
    (l as any).currency ?? pairCurrencies[`${l.tutor_id}:${l.student_id}`] ?? "UAH";
  const incomeByCur: [string, number][] = dbTotals
    ? Object.entries(dbTotals.income_by_currency).map(([c, v]) => [c, Number(v)] as [string, number])
        .filter(([, v]) => v > 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    : sumByCurrency(
        periodBillable.filter((l) => l.student_payment_status === "paid"),
        (l) => Number(l.student_price ?? 0), rowCurrency);
  // P0.7: середнє — лише в домінантній валюті, а не сума яблук із метрами.
  const domCur = incomeByCur[0]?.[0] ?? "UAH";
  const domPaidCount = periodBillable.filter(
    (l) => l.student_payment_status === "paid" && rowCurrency(l) === domCur).length;
  const avgLesson = domPaidCount > 0 ? Math.round((incomeByCur[0]?.[1] ?? 0) / domPaidCount) : 0;
  // 6-month stacked bars
  /* Перевірка 02.09: стовпчики були німі — висота є, числа немає, і натиснути
     не можна, хоча рука тягнеться. Тепер над кожним стовпчиком стоїть сума, а
     сам стовпчик — кнопка, що розкриває місяць: отримано, очікує, скільки
     уроків. Ключ місяця став `YYYY-MM`: коротка назва повторюється через рік
     і два різні місяці зливались в один стовпчик. І рахуємо лише домінантну
     валюту — суму гривень з євро не можна класти в один стовпчик. */
  const sixMonthBars = useMemo(() => {
    const map = new Map<string, { earned: number; pending: number; count: number; label: string }>();
    const now = new Date();
    const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      map.set(keyOf(d), {
        earned: 0, pending: 0, count: 0,
        label: d.toLocaleDateString(getLocale(), { month: "short" }),
      });
    }
    billable.forEach(l => {
      if (rowCurrency(l) !== domCur) return;
      const d = new Date(l.starts_at);
      const entry = map.get(keyOf(d));
      if (!entry) return;
      if (l.student_payment_status === "paid") { entry.earned += Number(l.student_price); entry.count += 1; }
      else if (l.status === "completed") { entry.pending += Number(l.student_price); entry.count += 1; }
    });
    const rows = Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
    const maxVal = Math.max(...rows.map(r => r.earned + r.pending), 1);
    return rows.map(r => ({ ...r, earnedPct: r.earned/maxVal*100, pendingPct: r.pending/maxVal*100 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billable, domCur, pairCurrencies]);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const pendingByCur = sumByCurrency(
    periodStudentDebts,
    (l) => Number(l.student_price ?? 0), rowCurrency);
  const fmtCurList = (entries: Array<[string, number]>, zeroCur = "UAH") =>
    entries.length === 0
      ? formatPrice(0, zeroCur)
      : entries.map(([c, v]) => formatPrice(v, c)).join(" + ");

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
    // Чесне порівняння: не «10 днів vs повний місяць», а той самий ВІДРІЗОК
    // минулого місяця (з точністю до години). Якщо минулий місяць коротший —
    // обрізаємо його кінцем.
    const elapsed = now.getTime() - monthStart;
    const prevAlignedEnd = Math.min(prevStart + elapsed, monthStart);
    let thisMonth = 0, lastMonth = 0, projected = 0, completedSum = 0, completedCount = 0, cancelledLost = 0;
    // Trends/forecast only make sense within one currency — restrict to the
    // dominant one (by total priced volume) instead of adding ₴ to €.
    const volumes: Record<string, number> = {};
    tutorScoped.forEach((l) => {
      const v = Number(l.student_price) || 0;
      if (v > 0) { const c = rowCurrency(l); volumes[c] = (volumes[c] ?? 0) + v; }
    });
    const cur = Object.entries(volumes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UAH";
    tutorScoped.forEach((l) => {
      if (rowCurrency(l) !== cur) return;
      const ts = new Date(l.starts_at).getTime();
      const price = Number(l.student_price) || 0;
      const paid = l.student_payment_status === "paid";
      if (ts >= monthStart) {
        if (paid) thisMonth += price;
        if (l.status === "cancelled" && !(l as any).is_cancellation_fee) cancelledLost += price; // P0.10
        else if (l.status !== "pending") projected += price; // booked total this month
        if (l.status === "completed") { completedSum += price; completedCount += 1; }
      } else if (ts >= prevStart && ts < prevAlignedEnd) {
        if (paid) lastMonth += price;
      }
    });
    const momPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
    const avgLesson = completedCount > 0 ? Math.round(completedSum / completedCount) : 0;
    return { thisMonth, lastMonth, momPct, projected, completedCount, avgLesson, cancelledLost, cur };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorScoped, pairCurrencies]);

  // №8 (ідеї 01.09): «який предмет вигідніший за годину» — перший розріз по
  // предметах у застосунку. Оплачені уроки домінантної валюти за весь
  // завантажений рік; показуємо лише коли предметів ≥2 (інакше нема порівняння).
  const bySubjectCockpit = useMemo(() => {
    const agg = new Map<string, { amount: number; minutes: number; count: number }>();
    tutorScoped.forEach((l) => {
      if (rowCurrency(l) !== analyticsStats.cur) return;
      if (l.student_payment_status !== "paid") return;
      const price = Number(l.student_price) || 0;
      if (price <= 0) return;
      const key = (l.subject ?? "").trim() || "—";
      const e = agg.get(key) ?? { amount: 0, minutes: 0, count: 0 };
      e.amount += price;
      e.minutes += Number(l.duration_minutes) || 60;
      e.count += 1;
      agg.set(key, e);
    });
    return Array.from(agg.entries())
      .map(([subject, v]) => ({
        subject, ...v,
        perHour: v.minutes > 0 ? Math.round(v.amount / (v.minutes / 60)) : 0,
        /* Перевірка 02.09: у рядку стояли лише сума і кількість уроків, тож
           «1600 ₴ · 4 уроки» читалось як 400 ₴/год, а поруч писало 427 —
           виглядало як помилка. Насправді ділиться на ГОДИНИ, а уроки різної
           тривалості. Показуємо години, і число стає перевірним. */
        hours: Math.round((v.minutes / 60) * 10) / 10,
      }))
      .sort((a, b) => b.perHour - a.perHour);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorScoped, analyticsStats.cur, pairCurrencies]);

  // №9 (ідеї 01.09): скасування нарешті зведені — частка зривів за 90 днів
  // і хто скасовує найчастіше (сигнал «щось не так з парою»).
  const cancelStats = useMemo(() => {
    const nowTs = Date.now();
    const windowStart = nowTs - 90 * 86400000;
    let cancelled = 0, held = 0;
    const byStudent = new Map<string, number>();
    tutorScoped.forEach((l) => {
      const ts = new Date(l.starts_at).getTime();
      if (ts < windowStart || ts > nowTs) return;
      if (l.status === "cancelled") {
        cancelled += 1;
        if (l.student_id) byStudent.set(l.student_id, (byStudent.get(l.student_id) ?? 0) + 1);
      } else if (l.status === "completed") {
        held += 1;
      }
    });
    const total = cancelled + held;
    const top = Array.from(byStudent.entries()).sort((a, b) => b[1] - a[1])[0];
    return {
      cancelled,
      ratePct: total > 0 ? Math.round((cancelled / total) * 100) : 0,
      // Імʼя показуємо лише від 2 скасувань — один раз буває у всіх.
      topName: top && top[1] >= 2 ? nameOf(top[0]) : null,
      topCount: top?.[1] ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorScoped]);



  // While independence is still loading, a hub tutor would momentarily read as
  // !isIndependent and could flash the leaking manager view — show a skeleton until
  // we know the role for sure. (Managers resolve wsLoading instantly: not a tutor.)
  if (isTutor && wsLoading) {
    return (
      <>
        <FinancesSkeleton />
      </>
    );
  }

  /* Аудит 02.09: скелет і стан помилки споживались ЛИШЕ в менеджерській гілці
     рендера — а обидві репетиторські повертаються РАНІШЕ (isHubTutor нижче,
     гілка самостійного ще нижче). Тобто головна персона релізу при збої
     читання бачила впевнене «Отримано 0» і «Операцій за період немає».
     Гейт піднято ВИЩЕ за розгалуження персон, щоб накривав усі три. */
  if (isTutor && !isManager) {
    /* Налаштування прочитались, а рядка немає: персона НЕ «хабовий», персона
       невідома. Без цієї гілки самостійного репетитора кидало в хабовий
       кабінет із «До виплати від хабу» замість його власних грошей. */
    if (workspaceUnknown) {
      return (
        <>
          <ErrorState onRetry={() => void fetchData()} retrying={loading} />
        </>
      );
    }
    if (loading) {
      return (
        <>
          <FinancesSkeleton />
        </>
      );
    }
    if (loadError) {
      return (
        <>
          <ErrorState onRetry={() => void fetchData()} retrying={loading} />
        </>
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HUB TUTOR: payout-only view. NEVER shows student_price, hub margin, student→hub
  // debt, profit/margin analytics, or a student-payment toggle — a hub tutor is PAID
  // by the hub. "Received" = Σ paid tutor_payout, "Pending" = Σ unpaid tutor_payout.
  // ─────────────────────────────────────────────────────────────────────────────
  if (isHubTutor) {
    const H = {
      teal: "#2BBFAA", tealD: "#25a896",
      warn: "#f59e0b", warnD: "#b4740b", warnBg: "rgba(245,158,11,.1)", warnBorder: "rgba(245,158,11,.3)",
      border: "var(--ds-border,#eceef3)", surface: "var(--ds-surface,#fff)",
      txt: "var(--ds-txt,#0f0f1a)", sub: "var(--sub,#666b82)", muted: "var(--ds-muted,#6f7489)",
      display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
    };
    // Their own lessons, individual only (group lessons carry no tutor payout), newest
    // first. Read ONLY payout fields — student_price is never referenced here.
    const payoutLessons = [...periodBillable]
      .filter((l) => l.kind !== "group")
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
    const paidCount = payoutLessons.filter((l) => l.tutor_payout_status === "paid").length;
    const pendingCount = payoutLessons.filter((l) => l.tutor_payout_status === "unpaid").length;

    const pill = (p: Period) => (
      <button key={p} onClick={() => setPeriod(p)}
        role="radio" aria-checked={period === p}
        aria-label={p === "week" ? t("finances.periodWeekShort") : p === "month" ? t("finances.periodMonthShort") : t("finances.periodAllShort")}
        style={{
          height: 34, padding: "0 16px", borderRadius: 999, border: "none", cursor: "pointer",
          fontFamily: H.display, fontWeight: 700, fontSize: 14,
          background: period === p ? H.teal : "#F5F4F0",
          color: period === p ? "#0f0f1a" : H.sub,
          boxShadow: period === p ? "0 4px 12px -4px rgba(43,191,170,.5)" : "none",
          transition: "all .15s",
        }}>
        {p === "week" ? t("finances.periodWeekShort") : p === "month" ? t("finances.periodMonthShort") : t("finances.periodAllShort")}
      </button>
    );

    return (
      <>
        <div className="mb-4">
          <h1 className="hidden lg:block font-display text-xl font-bold text-foreground sm:text-2xl">{t("finances.title")}</h1>
          <p className="text-[14px] text-muted-foreground sm:text-sm">{t("finances.pageSubtitleHubTutor")}</p>
        </div>
        {truncatedYear && <TruncatedYearBanner n={truncatedYear} />}
        {totalsParity === false && (
          <p role="status" className="mb-3 text-[13px] text-amber-800">{t("finances.totalsParityMismatch")}</p>
        )}

        {/* Period pills */}
        <div role="radiogroup" aria-label={t("finances.periodFilterAria")} style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {(["week", "month", "all"] as Period[]).map(pill)}
        </div>

        <div className="flex flex-col lg:flex-row gap-5">
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {/* Stat cards: Received (dark) + Pending */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1/-1", borderRadius: 20, padding: "18px 20px",
                background: "linear-gradient(135deg,#0f0f1a,#1a1a2e)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100,
                  borderRadius: "50%", background: "radial-gradient(circle,rgba(43,191,170,.35),transparent)" }} />
                <p style={{ fontFamily: H.display, fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,.5)",
                  textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                  💰 {t("finances.payoutReceived")}
                </p>
                <p style={{ fontFamily: H.display, fontWeight: 900, fontSize: 38, color: H.teal, letterSpacing: "-0.025em", lineHeight: 1 }}>
                  {formatPrice(totalExpense, "UAH")}
                </p>
                {pendingExpense > 0 && (
                  <p style={{ fontFamily: H.body, fontSize: 14, color: "rgba(255,255,255,.45)", marginTop: 6 }}>
                    + {t("finances.payoutPendingAmount", { sum: formatPrice(pendingExpense, "UAH") })}
                  </p>
                )}
              </div>

              <div style={{ gridColumn: "1/-1", borderRadius: 16, padding: "14px 16px",
                background: H.warnBg, border: `1px solid ${H.warnBorder}` }}>
                <p style={{ fontFamily: H.display, fontSize: 14, fontWeight: 700, color: H.warnD,
                  textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                  ⏳ {t("finances.payoutPendingLabel")}
                </p>
                <p style={{ fontFamily: H.display, fontWeight: 800, fontSize: 22, color: H.warnD }}>
                  {formatPrice(pendingExpense, "UAH")}
                </p>
                <p style={{ fontFamily: H.body, fontSize: 14, color: H.warnD, opacity: 0.7, marginTop: 2 }}>
                  {t("finances.lessonsCount", { count: pendingCount })}
                </p>
              </div>
            </div>

            {/* Payout list (read-only — the hub marks payouts, not the tutor) */}
            <div style={{ borderRadius: 18, background: H.surface, border: `1px solid ${H.border}`,
              overflow: "hidden", boxShadow: "0 2px 10px -4px rgba(15,15,26,.06)" }}>
              <div style={{ padding: "14px 16px", borderBottom: `1px solid ${H.border}` }}>
                <p style={{ fontFamily: H.display, fontWeight: 800, fontSize: 16, color: H.txt }}>
                  {t("finances.payoutHistoryTitle")}
                </p>
                <p style={{ fontFamily: H.body, fontSize: 14, color: H.sub, marginTop: 2 }}>
                  {t("finances.payoutHistorySubtitle")}
                </p>
              </div>
              <div style={{ padding: "12px 16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                {payoutLessons.length === 0 ? (
                  <p style={{ textAlign: "center", padding: "20px 0", color: H.muted, fontFamily: H.body, fontSize: 14 }}>
                    {t("finances.noData")}
                  </p>
                ) : (
                  payoutLessons.slice(0, 60).map((l) => {
                    const paid = l.tutor_payout_status === "paid";
                    return (
                      <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 12px", borderRadius: 14,
                        background: paid ? "rgba(34,197,94,.05)" : H.warnBg,
                        border: `1px solid ${paid ? "rgba(34,197,94,.15)" : H.warnBorder}` }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                          background: paid ? "rgba(34,197,94,.1)" : H.warnBg,
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                          {paid ? "✓" : "⏳"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: H.display, fontWeight: 700, fontSize: 14, color: H.txt,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {l.subject}
                          </p>
                          <p style={{ fontFamily: H.body, fontSize: 14, color: H.sub }}>
                            {new Date(l.starts_at).toLocaleDateString(getLocale(), { day: "numeric", month: "short" })} · {nameOf(l.student_id)}
                          </p>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <p style={{ fontFamily: H.display, fontWeight: 800, fontSize: 15, color: paid ? "#16a34a" : H.warnD }}>
                            {formatPrice(Number(l.tutor_payout), "UAH")}
                          </p>
                          <span style={{ fontFamily: H.display, fontWeight: 700, fontSize: 14,
                            color: paid ? "#16a34a" : H.warnD }}>
                            {paid ? t("finances.payoutPaidChip") : t("finances.payoutPendingChip")}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Export — payout-only CSV (no student price / margin) */}
            <button onClick={() => setExportOpen(true)}
              style={{ height: 46, borderRadius: 14, border: `1px solid ${H.border}`, background: H.surface, cursor: "pointer",
                fontFamily: H.display, fontWeight: 700, fontSize: 14, color: H.sub,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Download className="h-4 w-4" /> {t("finances.downloadCsv")}
            </button>
          </div>

          {/* RIGHT sidebar — desktop only */}
          <div className="hidden lg:flex flex-col gap-4" style={{ width: 300, flexShrink: 0 }}>
            {pendingExpense > 0 && (
              <div style={{ borderRadius: 18, padding: "16px 18px", background: H.warnBg, border: `1px solid ${H.warnBorder}` }}>
                <p style={{ fontFamily: H.display, fontWeight: 700, fontSize: 16, color: H.warnD, marginBottom: 4 }}>
                  ⏳ {t("finances.payoutPendingAmount", { sum: formatPrice(pendingExpense, "UAH") })}
                </p>
                <p style={{ fontFamily: H.body, fontSize: 14, color: H.warnD, opacity: 0.8 }}>
                  {t("finances.lessonsCount", { count: pendingCount })}
                </p>
              </div>
            )}
            <div style={{ borderRadius: 18, padding: "16px 18px", background: "rgba(34,197,94,.06)", border: "1px solid rgba(34,197,94,.2)" }}>
              <p style={{ fontFamily: H.display, fontWeight: 700, fontSize: 16, color: "#16a34a", marginBottom: 4 }}>
                ✓ {t("finances.payoutReceived")}: {formatPrice(totalExpense, "UAH")}
              </p>
              <p style={{ fontFamily: H.body, fontSize: 14, color: "#15803d", opacity: 0.85 }}>
                {t("finances.lessonsCount", { count: paidCount })}
              </p>
            </div>
          </div>
        </div>

        {/* CSV export options (reuses the shared dialog; exportCsv emits payout-only
            columns for a hub tutor). */}
        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="max-w-sm rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] overflow-y-auto">
            <div className="mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-border sm:hidden" />
            <DialogHeader>
              <DialogTitle>{t("finances.exportTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[14px] font-semibold text-foreground">{t("finances.exportInclude")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([["all", "exportKindAll"], ["paid", exportPaidKey], ["unpaid", exportUnpaidKey]] as [typeof exportKind, string][]).map(([val, key]) => (
                    <button key={val} type="button" onClick={() => setExportKind(val)}
                      className={cn(
                        "h-10 rounded-[12px] border text-[14px] font-semibold transition-colors",
                        exportKind === val ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}>
                      {t(`finances.${key}`)}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button"
                onClick={() => { exportCsv({ kind: exportKind }); setExportOpen(false); }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[12px] text-[15px] font-semibold text-white"
                style={{ background: "var(--teal,#2BBFAA)" }}>
                <Download className="h-4 w-4" /> {t("finances.exportDownload")}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEPENDENT TUTOR: Cockpit (Variant Б)
  // ─────────────────────────────────────────────────────────────────────────────
  if (isIndependentTutor) {

    const pill = (p: Period) => (
      <button key={p} onClick={() => setPeriod(p)}
        role="radio" aria-checked={period === p}
        aria-label={p==="week"?t("finances.periodWeekShort"):p==="month"?t("finances.periodMonthShort"):t("finances.periodAllShort")}
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


    return (
      <>
        {/* Аудит 03.09: банер стояв лише в хабовій і менеджерській гілках —
            тобто головна персона релізу не дізнавалась, що підсумок рахується
            з обрізаних даних. 500 уроків за рік — це ~10 на тиждень. */}
        {truncatedYear && <TruncatedYearBanner n={truncatedYear} />}

        {/* Period pills */}
        <div role="radiogroup" aria-label={t("finances.periodFilterAria")} style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
          {(["week","month","all"] as Period[]).map(pill)}
        </div>

        {/* ── Desktop 2-col layout ─────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-5">

          {/* LEFT column */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* Stats row */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {/* Earned — dark gradient; клік → Аналітика */}
              <button type="button" onClick={() => goTab("analytics")} aria-label={t("finances.tabAnalytics")}
                style={{ gridColumn:"1/-1", borderRadius:20, padding:"12px 16px", textAlign:"left", width:"100%",
                border:"none", cursor:"pointer",
                background:"linear-gradient(135deg,#0f0f1a,#1a1a2e)", position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:-20, right:-20, width:100, height:100,
                  borderRadius:"50%", background:"radial-gradient(circle,rgba(43,191,170,.35),transparent)" }} />
                <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:"rgba(255,255,255,.5)",
                  textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>
                  💰 {t("finances.received")}
                </p>
                <p style={{ fontFamily:F.display, fontWeight:900, fontSize: incomeByCur.length > 1 ? 24 : 30, color:F.teal,
                  letterSpacing:"-0.025em", lineHeight:1.1 }}>
                  {fmtCurList(incomeByCur)}
                </p>
                {pendingIncome > 0 && (
                  <p style={{ fontFamily:F.body, fontSize:14, color:"rgba(255,255,255,.45)", marginTop:6 }}>
                    + {t("finances.pendingAmount", { sum: fmtCurList(pendingByCur) })}
                  </p>
                )}
              </button>

              {/* Pending — warn; клік → Борги */}
              <button type="button" onClick={() => goTab("debts")} aria-label={t("finances.tabDebts")}
                style={{ borderRadius:16, padding:"10px 14px", textAlign:"left", cursor:"pointer",
                background:F.warnBg, border:`1px solid ${F.warnBorder}` }}>
                <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:F.warnD,
                  textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>
                  ⏳ {t("finances.pendingLabel")}
                </p>
                <p style={{ fontFamily:F.display, fontWeight:800, fontSize: pendingByCur.length > 1 ? 16 : 19, color:F.warnD }}>
                  {fmtCurList(pendingByCur)}
                </p>
                <p style={{ fontFamily:F.body, fontSize: 14, color:F.warnD, opacity:0.7, marginTop:2 }}>
                  {t("finances.lessonsCount", { count: debtList.length })}
                </p>
              </button>

              {/* Avg; клік → Аналітика */}
              <button type="button" onClick={() => goTab("analytics")} aria-label={t("finances.tabAnalytics")}
                style={{ borderRadius:16, padding:"10px 14px", textAlign:"left", cursor:"pointer",
                background:"rgba(139,92,246,.08)", border:"1px solid rgba(139,92,246,.2)" }}>
                <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:"#7c3aed",
                  textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>
                  📊 {t("finances.avgLesson")}
                </p>
                <p style={{ fontFamily:F.display, fontWeight:800, fontSize:19, color:"#7c3aed" }}>
                  {formatPrice(avgLesson, incomeByCur[0]?.[0] ?? "UAH")}
                </p>
                <p style={{ fontFamily:F.body, fontSize: 14, color:"#7c3aed", opacity:0.7, marginTop:2 }}>
                  {t("finances.lessonsCount", { count: paidLessonsCount })}
                </p>
              </button>
            </div>

            {/* 3 tabs */}
            <div ref={finTabsRef} style={{ scrollMarginTop: 64, borderRadius:18, background:F.surface, border:`1px solid ${F.border}`,
              overflow:"hidden", boxShadow:"0 2px 10px -4px rgba(15,15,26,.06)" }}>
              {/* Tab header */}
              <div style={{ display:"flex", borderBottom:`1px solid ${F.border}` }}>
                <Tab active={finTab === "ops"} onClick={() => setFinTab("ops")} label={t("finances.tabOps")} />
                <Tab active={finTab === "debts"} onClick={() => setFinTab("debts")} label={t("finances.tabDebts")} count={debtList.length} />
                <Tab active={finTab === "analytics"} onClick={() => setFinTab("analytics")} label={t("finances.tabAnalytics")} />
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
                        <span style={{ fontFamily:F.display, fontSize: 14, fontWeight:700,
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
                            <p style={{ fontFamily:F.body, fontSize: 14, color:F.sub }}>
                              {new Date(l.starts_at).toLocaleDateString(getLocale(),{day:"numeric",month:"short"})} · {l.subject}
                            </p>
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0 }}>
                            <p style={{ fontFamily:F.display, fontWeight:800, fontSize:15,
                              color: paid ? "#16a34a" : F.warnD }}>
                              {paid ? "+" : ""}{formatPrice(Number(l.student_price), rowCurrency(l))}
                            </p>
                            <button onClick={() => togglePayment(l, "student_payment_status")}
                              style={{ fontFamily:F.display, fontWeight:700, fontSize: 14,
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
                      {/* Auto-reminder hint — deep-link to the reminders toggle in
                          ProfilePage's <div id="rules"> (ProfilePage scrolls to the hash). */}
                      <Link to="/profile#rules" style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12,
                        padding:"10px 13px", borderRadius:12, textDecoration:"none",
                        background:"rgba(43,191,170,.07)", border:"1px solid rgba(43,191,170,.25)" }}>
                        <span style={{ fontSize:15 }}>🔔</span>
                        <span style={{ flex:1, fontFamily:F.body, fontSize:14, color:F.txt, lineHeight:1.35 }}>
                          {t("finances.autoReminderHintPre")} <b>{t("finances.autoReminderHintBold")}</b> {t("finances.autoReminderHintPost")}
                        </span>
                        <span style={{ fontFamily:F.display, fontWeight:700, fontSize:14, color:"#1f8e7e", flexShrink:0 }}>{t("finances.configureLink")}</span>
                      </Link>
                      {/* Summary warning */}
                      <div style={{ borderRadius:14, padding:"12px 14px", marginBottom:14,
                        background:F.warnBg, border:`1px solid ${F.warnBorder}`,
                        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <div>
                          <p style={{ fontFamily:F.display, fontWeight:700, fontSize:16, color:F.warnD }}>
                            ⚠️ {t("finances.notReceivedAmount", { sum: fmtCurList(pendingByCur) })}
                          </p>
                          <p style={{ fontFamily:F.body, fontSize:14, color:F.warnD, opacity:0.8 }}>
                            {t("finances.lessonsUnpaid", { count: debtList.length })}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            const snapshot = debtList.map(l => ({ id: l.id, status: l.student_payment_status, paidAt: l.student_paid_at }));
                            const ids = snapshot.map(s => s.id);
                            const nowIso = new Date().toISOString();
                            // Optimistic FIRST → instant feedback (binding invariant): haptic +
                            // toast now, THEN await the writes and revert only on error. (Was
                            // await-first + no haptic — the same dead-hang bug fixed elsewhere.)
                            setLessons(prev => prev.map(l =>
                              ids.includes(l.id) ? {...l, student_payment_status:"paid", student_paid_at: nowIso} as LessonRow : l
                            ));
                            haptic.success();
                            toast.success(t("finances.allMarkedPaid"));
                            void (async () => {
                              // Route each debt to the right table (group → lesson_participants).
                              const results = await Promise.all(debtList.map(l => writeStudentPayment(l, "paid", nowIso)));
                              if (results.some(r => r?.error)) {
                                setLessons(prev => prev.map(l => {
                                  const s = snapshot.find(x => x.id === l.id);
                                  return s ? {...l, student_payment_status: s.status, student_paid_at: s.paidAt} as LessonRow : l;
                                }));
                                haptic.error();
                                toast.error(t("finances.updateStatusFailed"));
                              }
                            })();
                          }}
                          style={{ height:44, padding:"0 16px", borderRadius:12, border:"none",
                            background:"rgba(245,158,11,.25)", color:F.warnD,
                            fontFamily:F.display, fontWeight:700, fontSize:15, cursor:"pointer",
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
                              <p style={{ fontFamily:F.body, fontSize: 14, color:F.sub }}>
                                {new Date(l.starts_at).toLocaleDateString(getLocale(),{day:"numeric",month:"short"})} · {l.subject}
                              </p>
                            </div>
                            <p style={{ fontFamily:F.display, fontWeight:800, fontSize:16,
                              color:F.warnD, flexShrink:0 }}>
                              {formatPrice(Number(l.student_price), rowCurrency(l))}
                            </p>
                            {l.kind === "group" ? (
                              // The remind-payment edge fn is individual-only (404s on a
                              // group lesson's synthetic id), so offer a chat link instead.
                              <Link
                                to={`/chats?with=${l.student_id}`}
                                title={t("finances.groupChatHint")}
                                style={{ height:32, padding:"0 12px", borderRadius:9, textDecoration:"none",
                                  background:"rgba(43,191,170,.12)", color:"#1f8e7e",
                                  fontFamily:F.display, fontWeight:700, fontSize: 14,
                                  flexShrink:0, display:"inline-flex", alignItems:"center", gap:6 }}>
                                💬 {t("finances.groupChatHint")}
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={() => remindLesson(l.id, l.student_id)}
                                disabled={remindingId === l.id}
                                style={{ height:32, padding:"0 12px", borderRadius:9, border:"none",
                                  background:"rgba(245,158,11,.18)", color:F.warnD,
                                  fontFamily:F.display, fontWeight:700, fontSize: 14,
                                  cursor: remindingId === l.id ? "default" : "pointer",
                                  flexShrink:0, display:"inline-flex", alignItems:"center", gap:6 }}>
                                {remindingId === l.id && <Loader2 className="h-3 w-3 animate-spin" />}
                                {t("finances.remindBtn")}
                              </button>
                            )}
                            {/* C5: було 32×32 за 6px від «Нагадати» — випадковий тап
                                позначав урок оплаченим. Тепер 44×40 з відступом. */}
                            <button
                              onClick={() => togglePayment(l, "student_payment_status")}
                              aria-label={t("finances.statusPaid")}
                              style={{ width:44, height:40, marginLeft:6, borderRadius:10, border:"1.5px solid rgba(43,191,170,.4)",
                                background:"#f0fdf9", color:"#1f8e7e", cursor:"pointer", flexShrink:0,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontWeight:800, fontSize:15 }}>
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
                    <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>{t("finances.thisMonth")}</p>
                    <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
                      <span style={{ fontFamily:F.display, fontWeight:800, fontSize:34, letterSpacing:"-0.02em", color:F.txt }}>
                        {formatPrice(analyticsStats.thisMonth, analyticsStats.cur)}
                      </span>
                      {analyticsStats.momPct !== null && (
                        <span style={{ display:"inline-flex", alignItems:"center", gap:4, borderRadius:999, padding:"4px 10px",
                          fontFamily:F.display, fontWeight:700, fontSize: 14,
                          background: analyticsStats.momPct >= 0 ? "rgba(34,197,94,.12)" : "rgba(245,158,11,.14)",
                          color: analyticsStats.momPct >= 0 ? "#16a34a" : F.warnD }}>
                          {analyticsStats.momPct >= 0 ? "▲" : "▼"} {t("finances.vsLastMonth", { pct: Math.abs(analyticsStats.momPct) })}
                        </span>
                      )}
                    </div>
                    {analyticsStats.projected > analyticsStats.thisMonth && (
                      <p style={{ fontFamily:F.body, fontSize:14, color:F.sub, marginTop:7, lineHeight:1.45 }}>
                        {t("finances.forecastPre")} <b style={{ color:F.txt }}>≈ {formatPrice(analyticsStats.projected, analyticsStats.cur)}</b> {t("finances.forecastPost")}
                      </p>
                    )}
                  </div>

                  {/* Not received */}
                  {pendingIncome > 0 && (
                    <div style={{ borderRadius:16, padding:"14px 16px", background:F.warnBg, border:`1px solid ${F.warnBorder}` }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                        <div>
                          <p style={{ fontFamily:F.display, fontWeight:800, fontSize:18, color:F.warnD }}>
                            {t("finances.notReceivedAmount", { sum: fmtCurList(pendingByCur) })}
                          </p>
                          <p style={{ fontFamily:F.body, fontSize: 14, color:F.warnD, opacity:0.85, marginTop:1 }}>
                            {t("finances.lessonsAwaitPayment", { count: debtList.length })}
                          </p>
                        </div>
                        <button onClick={() => setFinTab("debts")}
                          style={{ flexShrink:0, height:36, padding:"0 14px", borderRadius:10, border:"none", cursor:"pointer",
                            background:"rgba(245,158,11,.18)", color:F.warnD, fontFamily:F.display, fontWeight:700, fontSize:14 }}>
                          {t("finances.whoOwes")}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 6-month trend */}
                  <div>
                    <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>{t("finances.income6Months")}</p>
                    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:84 }}>
                      {sixMonthBars.map(bar => {
                        const total = bar.earned + bar.pending;
                        const open = openMonth === bar.key;
                        return (
                        <button key={bar.key} type="button"
                          onClick={() => setOpenMonth(open ? null : bar.key)}
                          aria-pressed={open}
                          aria-label={t("finances.monthBarAria", { month: bar.label, sum: formatPrice(total, domCur) })}
                          style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                            border:"none", background:"transparent", padding:0, cursor:"pointer",
                            opacity: openMonth && !open ? 0.45 : 1, transition:"opacity .15s" }}>
                          {/* Перевірка 02.09: висота без числа не читається — суму видно одразу */}
                          <span style={{ fontFamily:F.display, fontSize:13, fontWeight:700, color: total > 0 ? F.txt : F.muted,
                            fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>
                            {total > 0 ? formatPrice(total, domCur) : "—"}
                          </span>
                          <div style={{ width:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end", height:64, gap:2 }}>
                            {bar.pendingPct > 0 && (
                              <div style={{ width:"100%", borderRadius:"3px 3px 0 0", height:`${bar.pendingPct}%`, minHeight:3, background:"rgba(245,158,11,.35)" }} />
                            )}
                            {bar.earnedPct > 0 && (
                              <div style={{ width:"100%", borderRadius: bar.pendingPct>0?"0":"3px 3px 0 0", height:`${bar.earnedPct}%`, minHeight:bar.earned>0?4:0, background:F.teal }} />
                            )}
                          </div>
                          <span style={{ fontFamily:F.display, fontSize: 14, fontWeight: open ? 800 : 700, color: open ? F.txt : F.muted }}>{bar.label}</span>
                        </button>
                        );
                      })}
                    </div>
                    {/* Розкритий місяць: три числа, які й шукають у стовпчику */}
                    {openMonth && (() => {
                      const b = sixMonthBars.find((x) => x.key === openMonth);
                      if (!b) return null;
                      return (
                        <div style={{ marginTop:10, borderRadius:12, border:`1px solid ${F.border}`, background:F.surface, padding:"10px 12px",
                          display:"flex", flexWrap:"wrap", alignItems:"baseline", gap:"4px 14px" }}>
                          <span style={{ fontFamily:F.display, fontWeight:800, fontSize:15, color:F.txt, textTransform:"capitalize" }}>{b.label}</span>
                          <span style={{ fontFamily:F.body, fontSize:14, color:F.sub }}>
                            {t("finances.received")}: <b style={{ color:F.txt, fontVariantNumeric:"tabular-nums" }}>{formatPrice(b.earned, domCur)}</b>
                          </span>
                          {b.pending > 0 && (
                            <span style={{ fontFamily:F.body, fontSize:14, color:F.warnD }}>
                              {t("finances.pendingLabel")}: <b style={{ fontVariantNumeric:"tabular-nums" }}>{formatPrice(b.pending, domCur)}</b>
                            </span>
                          )}
                          <span style={{ fontFamily:F.body, fontSize:14, color:F.sub }}>
                            {t("finances.monthBarLessons", { count: b.count })}
                          </span>
                        </div>
                      );
                    })()}
                    <div style={{ display:"flex", gap:14, marginTop:10 }}>
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:F.body, fontSize: 14, color:F.sub }}>
                        <span style={{ width:9, height:9, borderRadius:2, background:F.teal }} /> {t("finances.received")}
                      </span>
                      <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:F.body, fontSize: 14, color:F.sub }}>
                        <span style={{ width:9, height:9, borderRadius:2, background:"rgba(245,158,11,.55)" }} /> {t("finances.pendingLabel")}
                      </span>
                    </div>
                  </div>

                  {/* Top students */}
                  {byStudentCockpit.length > 0 && (
                    <div>
                      <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>{t("finances.topStudentsByIncome")}</p>
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {byStudentCockpit.map(s => {
                          const maxAmt = byStudentCockpit[0]?.amount ?? 1;
                          const pct = Math.max((s.amount / maxAmt) * 100, 4);
                          return (
                            <div key={s.student_id}>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                                <span style={{ fontFamily:F.body, fontSize:14, color:F.txt }}>{s.name}</span>
                                <span style={{ fontFamily:F.display, fontWeight:700, fontSize:14, color:F.txt }}>{formatPrice(s.amount, (s as any).cur ?? "UAH")}</span>
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

                  {/* №8 (ідеї 01.09): по предметах — «що вигідніше за годину» */}
                  {bySubjectCockpit.length >= 2 && (
                    <div>
                      <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>{t("finances.bySubjectTitle")}</p>
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {bySubjectCockpit.map((s) => {
                          const maxHr = bySubjectCockpit[0]?.perHour || 1;
                          const pct = Math.max((s.perHour / maxHr) * 100, 4);
                          return (
                            <div key={s.subject}>
                              <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                                <span style={{ fontFamily:F.body, fontSize:14, color:F.txt, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.subject}</span>
                                <span style={{ fontFamily:F.display, fontWeight:700, fontSize:14, color:F.txt, flexShrink:0 }}>
                                  {t("finances.perHourShort", { sum: formatPrice(s.perHour, analyticsStats.cur) })}
                                </span>
                              </div>
                              <div style={{ height:7, borderRadius:999, background:F.border }}>
                                <div style={{ height:"100%", borderRadius:999, width:`${pct}%`, background:F.teal, transition:"width .4s ease" }} />
                              </div>
                              <p style={{ fontFamily:F.body, fontSize:13, color:F.sub, marginTop:3 }}>
                                {t("finances.bySubjectRow", { sum: formatPrice(s.amount, analyticsStats.cur), count: s.count, hours: s.hours })}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div style={{ borderRadius:16, padding:"14px 16px", background:F.surface, border:`1px solid ${F.border}` }}>
                      <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em" }}>{t("finances.lessonsThisMonth")}</p>
                      <p style={{ fontFamily:F.display, fontWeight:800, fontSize:26, color:F.txt, marginTop:4 }}>{analyticsStats.completedCount}</p>
                    </div>
                    <div style={{ borderRadius:16, padding:"14px 16px", background:F.surface, border:`1px solid ${F.border}` }}>
                      <p style={{ fontFamily:F.display, fontSize: 14, fontWeight:700, color:F.muted, textTransform:"uppercase", letterSpacing:"0.07em" }}>{t("finances.avgLesson")}</p>
                      <p style={{ fontFamily:F.display, fontWeight:800, fontSize:26, color:F.txt, marginTop:4 }}>{formatPrice(analyticsStats.avgLesson, analyticsStats.cur)}</p>
                    </div>
                  </div>

                  {/* Cancellations — №9: тепер зі зведенням, не лише сума втрат */}
                  {(analyticsStats.cancelledLost > 0 || cancelStats.cancelled > 0) && (
                    <div style={{ borderRadius:14, padding:"12px 14px", background:"rgba(239,68,68,.06)", border:"1px solid rgba(239,68,68,.2)", display:"flex", alignItems:"flex-start", gap:10 }}>
                      <span style={{ fontSize:18 }}>🚫</span>
                      <div style={{ minWidth:0 }}>
                        {analyticsStats.cancelledLost > 0 && (
                          <p style={{ fontFamily:F.body, fontSize:14, color:F.txt, lineHeight:1.4 }}>
                            {t("finances.cancellationsPre")} <b>{formatPrice(analyticsStats.cancelledLost, analyticsStats.cur)}</b>{t("finances.cancellationsPost")}
                          </p>
                        )}
                        {cancelStats.cancelled > 0 && (
                          <p style={{ fontFamily:F.body, fontSize:14, color:F.txt, lineHeight:1.4, marginTop: analyticsStats.cancelledLost > 0 ? 4 : 0 }}>
                            {t("finances.cancelRate90d", { count: cancelStats.cancelled, pct: cancelStats.ratePct })}
                            {cancelStats.topName ? " " + t("finances.cancelTopStudent", { name: cancelStats.topName, count: cancelStats.topCount }) : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Export */}
                  <button onClick={() => setExportOpen(true)}
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
                  ⚠️ {t("finances.notReceivedAmount", { sum: fmtCurList(pendingByCur) })}
                </p>
                <p style={{ fontFamily:F.body, fontSize:14, color:F.warnD, opacity:0.8 }}>
                  {t("finances.lessonsUnpaid", { count: debtList.length })}
                </p>
              </div>
            )}
            {/* Export */}
            <button onClick={() => setExportOpen(true)}
              style={{ height:44, borderRadius:14, border:`1px solid ${F.border}`,
                background:F.surface, cursor:"pointer", fontFamily:F.display,
                fontWeight:700, fontSize:14, color:F.sub,
                display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              <Download className="h-4 w-4" /> {t("finances.downloadCsv")}
            </button>
          </div>

        </div>

        {/* CSV export options. An independent tutor only has their OWN data, so the
            tutor select is omitted — just kind (all / paid / unpaid) + download.
            Was missing from this subtree entirely, so the export buttons were dead. */}
        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="max-w-sm rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] overflow-y-auto">
            <div className="mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-border sm:hidden" />
            <DialogHeader>
              <DialogTitle>{t("finances.exportTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[14px] font-semibold text-foreground">{t("finances.exportInclude")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([["all", "exportKindAll"], ["paid", exportPaidKey], ["unpaid", exportUnpaidKey]] as [typeof exportKind, string][]).map(([val, key]) => (
                    <button key={val} type="button" onClick={() => setExportKind(val)}
                      className={cn(
                        "h-10 rounded-[12px] border text-[14px] font-semibold transition-colors",
                        exportKind === val ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}>
                      {t(`finances.${key}`)}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button"
                onClick={() => { exportCsv({ kind: exportKind }); setExportOpen(false); }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[12px] text-[15px] font-semibold text-white"
                style={{ background: "var(--teal,#2BBFAA)" }}>
                <Download className="h-4 w-4" /> {t("finances.exportDownload")}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Primary action (layout spec: Finances FAB = record payment) — the cockpit
            used to render neither the FAB nor the sheet, leaving the independent
            tutor's record-payment flow unreachable on their own Finances page. */}
        <RecordPaymentSheet
          open={recordOpen}
          onOpenChange={setRecordOpen}
          pairs={pairsList}
          unpaidLessons={unpaidLessonsForSheet}
          onMarkLessonPaid={markLessonPaidById}
          onWalletTopUp={fetchData}
        />
        <PageFAB onClick={() => setRecordOpen(true)} label={t("finances.recordPayment")} />
      </>
    );
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="hidden lg:block font-display text-xl font-bold text-foreground sm:text-2xl">{t("finances.title")}</h1>
          <p className="text-[14px] text-muted-foreground sm:text-sm">
            {isIndependentTutor ? t("finances.pageSubtitleTutor") : t("finances.pageSubtitleManager")}
          </p>
        </div>
        {truncatedYear && <TruncatedYearBanner n={truncatedYear} />}
        {totalsParity === false && (
          <p role="status" className="mb-3 text-[13px] text-amber-800">{t("finances.totalsParityMismatch")}</p>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {!isIndependentTutor && tutorOptions.length > 1 && (
            <div className="w-full sm:w-44">
              <Select value={tutorFilter} onValueChange={setTutorFilter}>
                <SelectTrigger aria-label={t("finances.allTutors")} className="h-11">
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
                <SelectTrigger aria-label={t("finances.allStudents")} className="h-11">
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
      ) : loadError ? (
        <ErrorState onRetry={() => void fetchData()} />
      ) : (
        <>
          {/* === Sticky summary card — always visible at top while scrolling === */}
          <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-medium text-muted-foreground">{periodLabel}</span>
                <div role="radiogroup" aria-label={t("finances.periodFilterAria")} className="flex gap-1.5">
                  {(["week", "month", "all"] as Period[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={period === p}
                      aria-label={p === "week"
                        ? t("finances.periodWeekShort")
                        : p === "month"
                        ? t("finances.periodMonthShort")
                        : t("finances.periodAllShort")}
                      onClick={() => setPeriod(p)}
                      style={{
                        height: 32, padding: "0 12px", borderRadius: 999, border: "none", cursor: "pointer",
                        fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14,
                        background: period === p ? "var(--teal,#2BBFAA)" : "var(--bg,#F5F4F0)",
                        color: period === p ? "#0f0f1a" : "var(--sub,#666b82)",
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
                  value={isIndependentTutor ? fmtCurList(incomeByCur) : formatPrice(totalIncome, "UAH")}
                  tone="success"
                />
                {!isIndependentTutor && (
                  <SummaryStat icon={ArrowUpRight} label={t("finances.payouts")} value={`${formatPrice(totalExpense, "UAH")}`} tone="neutral" />
                )}
                {!isIndependentTutor && (
                  <SummaryStat
                    icon={TrendingUp}
                    label={t("finances.profit")}
                    value={formatPrice(profit, "UAH")}
                    tone={profit >= 0 ? "success" : "warning"}
                  />
                )}
                <SummaryStat
                  icon={DollarSign}
                  label={t("finances.debtsTab")}
                  value={isIndependentTutor ? fmtCurList(pendingByCur) : formatPrice(totalDebt, "UAH")}
                  tone={parity && !parity.ok ? "warning" : totalDebt > 0 ? "warning" : "neutral"}
                />
              </div>
              {parity && (
                <p className={`mt-1.5 text-[13px] ${parity.ok ? "text-muted-foreground" : "font-semibold text-warning"}`}>
                  {parity.ok
                    ? t("finances.parityOk")
                    : t("finances.parityMismatch", { db: formatPrice(parity.db, "UAH"), app: formatPrice(parity.app, "UAH")})}
                </p>
              )}
            </div>

              {isManager && prepaidRows.length > 0 && (
                <div className="mt-3 rounded-[16px] border bg-card p-4" style={{ borderColor: "var(--border,var(--ds-border,#eceef3))" }}>
                  <p className="mb-2 text-[14px] font-bold text-foreground">💳 {t("finances.prepaidTitle")}</p>
                  <div className="space-y-1.5">
                    {prepaidRows.map((r) => (
                      <div key={`${r.tutor_id}:${r.student_id}`} className="flex items-center justify-between gap-3 text-[14px]">
                        <span className="min-w-0 truncate">
                          <span className="font-semibold text-foreground">{r.student_name}</span>
                          <span className="text-muted-foreground"> · {r.tutor_name}</span>
                        </span>
                        <span className="shrink-0 font-bold" style={{ color: "var(--teal,#2BBFAA)" }}>
                          {r.lessons > 0 && t("finances.prepaidLessonsShort", { count: r.lessons })}
                          {r.lessons > 0 && r.amount > 0 && " + "}
                          {r.amount > 0 && formatPrice(r.amount, "UAH")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                    {t("finances.debtTitle", { sum: formatPrice((totalDebt), "UAH")})}
                  </p>
                  <p className="text-[14px]" style={{ color: "#b45309", opacity: 0.8 }}>
                    {t("finances.debtAwaiting", { count: debtsRows.length })}
                  </p>
                </div>
              </div>
              <button
                disabled={remindingAll}
                onClick={async () => {
                  // B5: подвійний тап слав кожному боржнику ДВА нагадування —
                  // кнопка блокується на час розсилки.
                  if (remindingAll) return;
                  setRemindingAll(true);
                  try {
                  // One REAL reminder (email / Telegram) per student — anchor on their first debt lesson.
                  // Group debts are skipped: remind-payment is individual-only and 404s on a
                  // group row's synthetic id (write to those students in chat instead).
                  // NB: derived from periodBillable, NOT the tab-scoped debtList — on the
                  // Income tab that list is empty and the button used to fake-fail.
                  const seen = new Set<string>();
                  const reps = periodStudentDebts.filter((l) => {
                    if (!l.id || l.kind === "group" || seen.has(l.student_id)) return false;
                    seen.add(l.student_id);
                    return true;
                  });
                  /* Аудит 03.09: один тап слав СПРАВЖНІ листи й повідомлення
                     всім боржникам одразу — незворотно, за межі застосунку, і
                     скільки саме людей отримає, ніде не було видно до
                     відправки. Масова email-розсилка на /marketing давно має
                     підтвердження; тут його не було. */
                  if (reps.length > 0) {
                    const ok = await confirmDialog({
                      title: t("finances.remindAllConfirmTitle", { count: reps.length }),
                      description: t("finances.remindAllConfirmDesc"),
                      confirmText: t("finances.remindAllConfirmBtn"),
                    });
                    if (!ok) { setRemindingAll(false); return; }
                  }
                  if (reps.length === 0) {
                    // Nothing remindable (e.g. only group debts) — don't blame contacts.
                    toast.error(t("pendingPaymentsExtra.reminderGeneric"));
                    handleTabChange("debts");
                    return;
                  }
                  const results = await Promise.all(
                    reps.map((l) => supabase.functions.invoke("remind-payment", { body: { lessonId: l.id } })),
                  );
                  const sent = results.filter((r) => (r.data as any)?.success).length;
                  if (sent > 0) {
                    toast.success(t("finances.remindSentTitle"), { description: t("finances.remindSentDesc", { count: sent }) });
                  } else {
                    toast.error(t("pendingPaymentsExtra.reminderGeneric"));
                  }
                  handleTabChange("debts");
                  } finally {
                    setRemindingAll(false);
                  }
                }}
                className="flex-shrink-0 rounded-[10px] px-3 py-1.5 text-[14px] font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: "rgba(245,158,11,.2)", color: "#b45309", border: "1px solid rgba(245,158,11,.4)" }}>
                {t("people.remindBtn")}
              </button>
            </div>
          )}

          {/* === Tabs header with CSV download === */}
          <div className="flex items-center justify-between mb-0">
            <div className="flex-1" />
            <button
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[14px] font-semibold transition-colors hover:bg-muted"
              style={{ color: "var(--sub,#666b82)", border: "1px solid var(--border,var(--ds-border,#eceef3))" }}
              title={t("finances.exportCsv")}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>

          {/* === Main tabs: Income / Debts === */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2 h-11 bg-transparent border-b rounded-none p-0" style={{borderColor:"var(--border,var(--ds-border,#eceef3))"}}>
              <TabsTrigger value="income" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-[#2BBFAA] data-[state=active]:text-[#2BBFAA] data-[state=active]:shadow-none data-[state=active]:bg-transparent font-medium h-11 -mb-px">
                <ArrowDownLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("finances.incomeTab")}</span>
                <span className="sm:hidden">{t("finances.incomeTabShort")}</span>
                <span className="ml-1 text-[14px] text-muted-foreground">({incomeRows.filter((r) => r.type === "lesson").length})</span>
              </TabsTrigger>
              <TabsTrigger value="debts" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-[#2BBFAA] data-[state=active]:text-[#2BBFAA] data-[state=active]:shadow-none data-[state=active]:bg-transparent font-medium h-11 -mb-px">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("finances.debtsTab")}</span>
                <span className="sm:hidden">{t("finances.debtsTabShort")}</span>
                <span className="ml-1 text-[14px] text-muted-foreground">({debtsRows.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="income" className="mt-4">{renderRows(incomeRows)}</TabsContent>
            <TabsContent value="debts" className="mt-4">{renderRows(debtsRows)}</TabsContent>
          </Tabs>

          {/* === Selection bar — sticky, only when rows are selected (desktop) === */}
          {selected.size > 0 && (
            <div
              className="sticky bottom-4 z-30 mt-4 hidden items-center gap-2 rounded-[14px] border-[0.5px] bg-card px-4 py-3 lg:flex"
              style={{ borderColor: "var(--border,var(--ds-border,#eceef3))", boxShadow: "0 12px 32px -12px rgba(15,15,26,.3)" }}
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
                  className="flex h-10 items-center gap-1.5 rounded-[12px] border-[0.5px] bg-card px-4 text-[14px] font-bold transition-colors hover:bg-[#f0fdf9] disabled:opacity-50"
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
                style={{ color: "var(--sub,#666b82)" }}
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
                  <span className="text-[14px] text-muted-foreground">
                    {formatPrice(profitSparkline.reduce((s, b) => s + b.profit, 0), domCur)}
                  </span>
                </div>
                <Suspense fallback={<div className="animate-pulse" style={{ height: 180, borderRadius: 16, background: "#f3f4f6" }} />}><ProfitSparkline cur={domCur} data={profitSparkline} /></Suspense>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{t("finances.incomeByStudent")}{incomeByStudent[0]?.cur ? ` · ${incomeByStudent[0].cur}` : ""}</h2>
                  <span className="hidden text-[14px] text-muted-foreground sm:inline">{t("finances.paidOnly")}</span>
                </div>
                <Suspense fallback={<div className="animate-pulse" style={{ height: 180, borderRadius: 16, background: "#f3f4f6" }} />}><IncomeByStudentPie cur={incomeByStudent[0]?.cur ?? "UAH"} data={incomeByStudent} /></Suspense>
              </div>
            </div>
          )}

          {!isIndependentTutor && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{t("finances.marginByTutor")}</h2>
                <span className="hidden text-[14px] text-muted-foreground sm:inline">{t("finances.marginFormula")}</span>
              </div>
              {markupByTutor.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("finances.noMarginData")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[15px]">
                    <thead>
                      <tr className="border-b border-border text-[14px] text-muted-foreground">
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
                <span className="hidden text-[14px] text-muted-foreground sm:inline">{t("finances.completedOnly")}</span>
              </div>
              <Suspense fallback={<div className="animate-pulse" style={{ height: 180, borderRadius: 16, background: "#f3f4f6" }} />}><FinanceWeeklyChart cur={domCur}
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
          canDelete={isManager}
        />
      )}
      {/* CSV export options */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-sm rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] overflow-y-auto">
          <div className="mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-border sm:hidden" />
          <DialogHeader>
            <DialogTitle>{t("finances.exportTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[14px] font-semibold text-foreground">{t("finances.exportTutor")}</p>
              <Select value={exportTutor} onValueChange={setExportTutor}>
                <SelectTrigger aria-label={t("finances.exportTutor")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("finances.exportAllTutors")}</SelectItem>
                  {Array.from(new Set(periodBillable.map((l) => l.tutor_id))).map((id) => (
                    <SelectItem key={id} value={id}>{nameOf(id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-[14px] font-semibold text-foreground">{t("finances.exportInclude")}</p>
              <div className="grid grid-cols-3 gap-2">
                {([["all", "exportKindAll"], ["paid", exportPaidKey], ["unpaid", exportUnpaidKey]] as [typeof exportKind, string][]).map(([val, key]) => (
                  <button key={val} type="button" onClick={() => setExportKind(val)}
                    className={cn(
                      "h-10 rounded-[12px] border text-[14px] font-semibold transition-colors",
                      exportKind === val ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}>
                    {t(`finances.${key}`)}
                  </button>
                ))}
              </div>
            </div>
            <button type="button"
              onClick={() => { exportCsv({ tutorId: exportTutor, kind: exportKind }); setExportOpen(false); }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[12px] text-[15px] font-semibold text-white"
              style={{ background: "var(--teal,#2BBFAA)" }}>
              <Download className="h-4 w-4" /> {t("finances.exportDownload")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Підтвердження видалення передоплати */}
      <AlertDialog open={!!deletePrepayTx} onOpenChange={(o) => !deletingPrepay && !o && setDeletePrepayTx(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800 }}>
              {t("finances.deletePrepayConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletePrepayTx && (
                <>
                  {deletePrepayTx.lessons_delta > 0 && <b>+{deletePrepayTx.lessons_delta} {t("finances.lessonsUnit")} </b>}
                  {Number(deletePrepayTx.amount_delta) > 0 && <b>+{formatPrice(Number(deletePrepayTx.amount_delta), pairCurrencies[`${deletePrepayTx.tutor_id}:${deletePrepayTx.student_id}`] ?? "UAH")} </b>}
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
    </>
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
      <div className="flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground sm:text-[14px]">
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
          <span className="text-[14px] font-normal text-muted-foreground normal-case">{sublabel}</span>
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

