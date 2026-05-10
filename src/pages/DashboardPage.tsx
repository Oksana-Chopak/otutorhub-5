import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LessonWorkspace } from "@/components/LessonWorkspace";
import { FindTutorDialog } from "@/components/FindTutorDialog";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { IndependentTutorStats } from "@/components/IndependentTutorStats";
import { TutorWelcomeBanner } from "@/components/TutorWelcomeBanner";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { ReferralWidget } from "@/components/ReferralWidget";
import { PendingPaymentsCard } from "@/components/PendingPaymentsCard";
import { QuickPaymentFab } from "@/components/QuickPaymentFab";
import { ReferralNudgeBanner } from "@/components/ReferralNudgeBanner";
import { StudentWalletCard } from "@/components/StudentWalletCard";
import { WalletDialog } from "@/components/WalletDialog";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";
import { LessonDetailsDialog } from "@/components/LessonDetailsDialog";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { Wallet } from "lucide-react";
import { useTutorGamification } from "@/hooks/useTutorGamification";
import { useBadgeUnlockToasts } from "@/hooks/useBadgeUnlockToasts";
import { safeHref } from "@/lib/safeUrl";
import { LessonCard } from "@/components/LessonCard";
import { TutorNotesCard } from "@/components/TutorNotesCard";
import { NeedsMarkingCard } from "@/components/NeedsMarkingCard";
import { AutoCompletePromptDialog } from "@/components/AutoCompletePromptDialog";
import { QuickActionsCard } from "@/components/QuickActionsCard";
import {
  CalendarDays,
  Users,
  TrendingUp,
  Clock,
  Loader2,
  ChevronDown,
  Video,
  AlertTriangle,
  UserX,
  Tag,
  CalendarPlus,
  StickyNote,
  Plus,
  HandHeart,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type PaymentStatus = "paid" | "unpaid";

interface LessonRow {
  id: string;
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: LessonStatus;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PaymentStatus;
  tutor_payout_status: PaymentStatus;
  meeting_url: string | null;
  homework: string | null;
  summary: string | null;
  student_notes: string | null;
  source: "hub" | "independent";
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

const statusLabel: Record<LessonStatus, string> = {
  pending: "Запит",
  scheduled: "Заплановано",
  completed: "Проведено",
  cancelled: "Скасовано",
};

const statusClass: Record<LessonStatus, string> = {
  pending: "bg-warning/10 text-warning border-0",
  scheduled: "bg-primary/10 text-primary border-0",
  completed: "bg-success/10 text-success border-0",
  cancelled: "bg-destructive/10 text-destructive border-0",
};

type ProfitPeriod = "all" | "month" | "week";

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const { isIndependent, settings, loading: wsLoading } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isStudent = roles.includes("student");
  const isIndependentTutor = isTutor && !isManager && isIndependent;

  // Student-only users belong on /student-dashboard. Redirect them out of
  // the tutor/manager dashboard immediately to avoid mixed UI.
  useEffect(() => {
    if (isStudent && !isManager && !isTutor) {
      navigate("/student-dashboard", { replace: true });
    }
  }, [isStudent, isManager, isTutor, navigate]);

  // Note: previously we auto-redirected new tutors to /onboarding here.
  // Removed per UX feedback — instead we show an inline "Add first student"
  // CTA on the empty dashboard so the tutor isn't bounced to another page.

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tutorCount, setTutorCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [studentsWithoutTutor, setStudentsWithoutTutor] = useState(0);
  const [studentTutorCount, setStudentTutorCount] = useState(0);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [walletPair, setWalletPair] = useState<{ tutor_id: string; student_id: string; tutor_name: string; student_name: string } | null>(null);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const [profitPeriod, setProfitPeriod] = useState<ProfitPeriod>("all");
  const [myStudentCount, setMyStudentCount] = useState<number | null>(null);
  const [addStudentOpen, setAddStudentOpen] = useState(false);

  const [defaultMeetingUrls, setDefaultMeetingUrls] = useState<Record<string, string>>({});
  const [pairCurrency, setPairCurrency] = useState<Record<string, string>>({});

  // Gamification: badge unlock toasts + referral nudge counters
  const { badges, loading: gamificationLoading } = useTutorGamification();
  useBadgeUnlockToasts(badges, gamificationLoading);
  const [referralInvitedCount, setReferralInvitedCount] = useState(0);
  useEffect(() => {
    if (!user || !isIndependentTutor) return;
    supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", user.id)
      .then(({ count }) => setReferralInvitedCount(count ?? 0));
  }, [user?.id, isIndependentTutor]);

  // Announce the monthly recap card on the 1st-7th of each month.
  // Without this, tutors often never notice the "Твій <місяць>" share-card.
  useEffect(() => {
    if (!user || !isIndependentTutor) return;
    const today = new Date();
    if (today.getDate() > 7) return;
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const seenKey = `monthly_recap_announced_${monthKey}`;
    if (localStorage.getItem(seenKey) === "1") return;
    const months = [
      "січень", "лютий", "березень", "квітень", "травень", "червень",
      "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
    ];
    const prevMonthIdx = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    import("sonner").then(({ toast }) => {
      toast(`🎉 Твій ${months[prevMonthIdx]} готовий!`, {
        description: "Подивись підсумок місяця та поділись з друзями.",
        duration: 8000,
        action: {
          label: "Подивитись",
          onClick: () => {
            const el = document.getElementById("monthly-summary-anchor");
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          },
        },
      });
    });
    localStorage.setItem(seenKey, "1");
  }, [user?.id, isIndependentTutor]);



  const loadData = async () => {
    if (!user) return;

    const [
      { data: lessonsData },
      { data: profilesData },
      { data: rolesData },
      { data: requestRows },
      { data: ratesData },
      { data: defaultsData },
      { data: ratesCurrencyData },
    ] = await Promise.all([
      supabase
        .from("lessons_visible")
        .select(
          "id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, tutor_payout, student_payment_status, tutor_payout_status, meeting_url, homework, summary, student_notes, source"
        )
        .order("starts_at", { ascending: true }),
      supabase.from("profiles").select("id, first_name, last_name"),
      supabase.from("user_roles").select("user_id, role"),
      isManager
        ? supabase.from("availability_requests").select("id").eq("status", "open")
        : Promise.resolve({ data: [] as any[] }),
      isManager
        ? supabase.from("student_rates").select("student_id")
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("tutor_student_defaults")
        .select("tutor_id, student_id, default_meeting_url"),
      supabase
        .from("student_rates")
        .select("tutor_id, student_id, currency"),
    ]);

    const currencyMap: Record<string, string> = {};
    ((ratesCurrencyData ?? []) as Array<{ tutor_id: string; student_id: string; currency: string | null }>).forEach((r) => {
      currencyMap[`${r.tutor_id}:${r.student_id}`] = r.currency ?? "UAH";
    });
    setPairCurrency(currencyMap);

    console.log('[DashboardPage] lessons count:', (lessonsData ?? []).length, 'unique ids:', new Set((lessonsData ?? []).map((l: any) => l.id)).size);

    const profileMap: Record<string, string> = {};
    (profilesData as ProfileRow[] | null ?? []).forEach((profile) => {
      profileMap[profile.id] = `${profile.first_name} ${profile.last_name}`.trim() || "Без імені";
    });

    const defaultsMap: Record<string, string> = {};
    ((defaultsData ?? []) as Array<{
      tutor_id: string;
      student_id: string;
      default_meeting_url: string | null;
    }>).forEach((d) => {
      if (d.default_meeting_url && d.default_meeting_url.trim()) {
        defaultsMap[`${d.tutor_id}:${d.student_id}`] = d.default_meeting_url.trim();
      }
    });
    setDefaultMeetingUrls(defaultsMap);

    const roleRows = (rolesData ?? []) as Array<{ user_id: string; role: string }>;
    const tutorIds = roleRows.filter((r) => r.role === "tutor").map((r) => r.user_id);
    const studentIds = roleRows.filter((r) => r.role === "student").map((r) => r.user_id);
    setTutorCount(tutorIds.length);
    setStudentCount(studentIds.length);
    setPendingRequestCount((requestRows ?? []).length);

    if (isManager) {
      const linkedStudentIds = new Set<string>();
      ((ratesData ?? []) as Array<{ student_id: string }>).forEach((r) =>
        linkedStudentIds.add(r.student_id)
      );
      setStudentsWithoutTutor(studentIds.filter((id) => !linkedStudentIds.has(id)).length);
    }

    if (isStudent && !isManager && !isTutor) {
      const lessonRows = ((lessonsData ?? []) as LessonRow[]).filter((l) => l.student_id === user.id);
      const fromLessons = new Set(lessonRows.map((l) => l.tutor_id));
      const { data: myRates } = await supabase
        .from("student_rates")
        .select("tutor_id")
        .eq("student_id", user.id);
      (myRates ?? []).forEach((r: any) => fromLessons.add(r.tutor_id));
      setStudentTutorCount(fromLessons.size);
    }

    setProfiles(profileMap);
    const uniqueLessons = Array.from(
      new Map(((lessonsData ?? []) as LessonRow[]).map((l) => [l.id, l])).values()
    );
    setLessons(uniqueLessons);

    if (isIndependentTutor) {
      const { count } = await supabase
        .from("student_rates")
        .select("student_id", { count: "exact", head: true })
        .eq("tutor_id", user.id)
        .eq("source", "independent");
      setMyStudentCount(count ?? 0);
    }

    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  const todayLessons = useMemo(
    () => lessons.filter((lesson) => lesson.starts_at.slice(0, 10) === todayKey),
    [lessons, todayKey]
  );

  const upcomingAll = useMemo(
    () =>
      lessons
        .filter((lesson) => new Date(lesson.starts_at).getTime() >= nowMs - 60 * 60 * 1000)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [lessons, nowMs]
  );
  const todayPlusTomorrowLessons = useMemo(() => {
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    const tmrKey = tmr.toISOString().slice(0, 10);
    return upcomingAll.filter((l) => {
      const k = l.starts_at.slice(0, 10);
      return k === todayKey || k === tmrKey;
    });
  }, [upcomingAll, todayKey]);
  const upcomingLessons = showAllUpcoming ? upcomingAll : todayPlusTomorrowLessons;

  // ===== Profit (with period) =====
  const periodStart = useMemo(() => {
    const d = new Date();
    if (profitPeriod === "month") {
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    if (profitPeriod === "week") {
      const day = (d.getDay() + 6) % 7;
      const ws = new Date(d);
      ws.setDate(d.getDate() - day);
      ws.setHours(0, 0, 0, 0);
      return ws.getTime();
    }
    return 0;
  }, [profitPeriod]);

  const billableLessons = useMemo(
    () =>
      lessons.filter((l) => {
        if (l.status === "cancelled" || l.status === "pending") return false;
        if (new Date(l.starts_at).getTime() < periodStart) return false;
        if (l.status === "completed") return true;
        const isPast = new Date(l.starts_at).getTime() < nowMs;
        const hasPayment =
          l.student_payment_status === "paid" || l.tutor_payout_status === "paid";
        return isPast || hasPayment;
      }),
    [lessons, periodStart, nowMs]
  );

  const totalIncome = billableLessons
    .filter((l) => l.student_payment_status === "paid")
    .reduce((s, l) => s + Number(l.student_price), 0);
  const totalExpense = billableLessons
    .filter((l) => l.tutor_payout_status === "paid")
    .reduce((s, l) => s + Number(l.tutor_payout), 0);
  const profit = totalIncome - totalExpense;

  const pendingPayments = useMemo(
    () =>
      lessons.filter((l) => {
        if (l.status === "cancelled" || l.status === "pending") return false;
        const isPast = new Date(l.starts_at).getTime() < nowMs;
        const counts = l.status === "completed" || isPast;
        return (
          counts &&
          (l.student_payment_status === "unpaid" || l.tutor_payout_status === "unpaid")
        );
      }),
    [lessons, nowMs]
  );

  const lessonsWithoutPrice = useMemo(
    () =>
      lessons.filter(
        (l) =>
          (l.status === "scheduled" || l.status === "completed") &&
          (Number(l.student_price) === 0 || Number(l.tutor_payout) === 0)
      ).length,
    [lessons]
  );

  const effectiveMeetingUrl = (l: LessonRow): string | null => {
    if (l.meeting_url && l.meeting_url.trim()) return l.meeting_url.trim();
    const fallback = defaultMeetingUrls[`${l.tutor_id}:${l.student_id}`];
    return fallback || null;
  };

  const lessonsWithoutMeeting = useMemo(
    () =>
      lessons.filter(
        (l) =>
          l.status === "scheduled" &&
          new Date(l.starts_at).getTime() >= nowMs &&
          !effectiveMeetingUrl(l)
      ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lessons, nowMs, defaultMeetingUrls]
  );

  const pendingLessonRequests = useMemo(
    () => lessons.filter((l) => l.status === "pending").length,
    [lessons]
  );

  // Used to gate the referral nudge banner — show only after the tutor has
  // completed enough lessons to actually understand the product's value.
  const myCompletedLessonsCount = useMemo(
    () =>
      user
        ? lessons.filter((l) => l.tutor_id === user.id && l.status === "completed").length
        : 0,
    [lessons, user?.id]
  );

  const profitPeriodLabel: Record<ProfitPeriod, string> = {
    all: "за весь час",
    month: "за цей місяць",
    week: "за цей тиждень",
  };

  // Smart tasks list (manager-only)
  const smartTasks = useMemo(() => {
    if (!isManager) return [] as Array<{
      key: string;
      icon: any;
      tone: "warning" | "destructive" | "primary";
      title: string;
      description: string;
      to: string;
      cta: string;
    }>;
    const tasks = [];
    if (pendingLessonRequests > 0) {
      tasks.push({
        key: "pending-lessons",
        icon: AlertTriangle,
        tone: "warning" as const,
        title: `${pendingLessonRequests} запит${
          pendingLessonRequests === 1 ? "" : pendingLessonRequests < 5 ? "и" : "ів"
        } на уроки`,
        description: "Учні чекають підтвердження часу.",
        to: "/schedule",
        cta: "Відкрити розклад",
      });
    }
    if (pendingRequestCount > 0) {
      tasks.push({
        key: "availability-requests",
        icon: CalendarPlus,
        tone: "warning" as const,
        title: `${pendingRequestCount} запит${
          pendingRequestCount === 1 ? "" : pendingRequestCount < 5 ? "и" : "ів"
        } на проставлення годин`,
        description: "Репетитори або учні просять оновити доступні години.",
        to: "/availability",
        cta: "Перейти до годин",
      });
    }
    if (studentsWithoutTutor > 0) {
      tasks.push({
        key: "students-no-tutor",
        icon: UserX,
        tone: "destructive" as const,
        title: `${studentsWithoutTutor} учн${
          studentsWithoutTutor === 1 ? "ів" : studentsWithoutTutor < 5 ? "ів" : "ів"
        } без репетитора`,
        description: "Призначте ставку — без неї не буде ні уроків, ні чатів.",
        to: "/people",
        cta: "Відкрити людей",
      });
    }
    if (lessonsWithoutPrice > 0) {
      tasks.push({
        key: "no-price",
        icon: Tag,
        tone: "warning" as const,
        title: `${lessonsWithoutPrice} уроків без ціни`,
        description: "Додайте ставку, щоб коректно рахувати фінанси.",
        to: "/schedule",
        cta: "Відкрити уроки",
      });
    }
    if (lessonsWithoutMeeting > 0) {
      tasks.push({
        key: "no-meeting",
        icon: Video,
        tone: "primary" as const,
        title: `${lessonsWithoutMeeting} майбутніх уроків без посилання`,
        description: "Репетитори не вказали лінк на зустріч.",
        to: "/schedule",
        cta: "Відкрити розклад",
      });
    }
    if (pendingPayments.length > 0) {
      tasks.push({
        key: "pending-payments",
        icon: TrendingUp,
        tone: "warning" as const,
        title: `Очікують оплати: ${pendingPayments.length}`,
        description: "Завершені уроки без повної оплати або виплати.",
        to: "/finances",
        cta: "Перейти до фінансів",
      });
    }
    return tasks;
  }, [
    isManager,
    pendingLessonRequests,
    pendingRequestCount,
    studentsWithoutTutor,
    lessonsWithoutPrice,
    lessonsWithoutMeeting,
    pendingPayments.length,
  ]);

  return (
    <AppLayout>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">{t("dashboard.title")}</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isManager ? t("dashboard.subManager") : t("dashboard.subOther")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <>
              <Button asChild variant="outline"><Link to="/people">{t("dashboard.btnPeople")}</Link></Button>
              <Button asChild variant="outline"><Link to="/schedule">{t("dashboard.btnLessons")}</Link></Button>
              <Button asChild><Link to="/finances">{t("dashboard.btnPayments")}</Link></Button>
            </>
          )}
          {(isTutor || isStudent) && !isManager && (
            <>
              {isTutor && (
                <Button asChild>
                  <Link to="/schedule">
                    <Plus className="h-4 w-4" />
                    {t("dashboard.btnCreateLesson")}
                  </Link>
                </Button>
              )}
              {isStudent && !isTutor && (
                <FindTutorDialog
                  trigger={
                    <Button>
                      <HandHeart className="h-4 w-4" />
                      {t("dashboard.btnRequestTutor")}
                    </Button>
                  }
                />
              )}
              {isTutor && (
                <Button asChild variant="outline">
                  <Link to="/availability">
                    <CalendarPlus className="h-4 w-4" />
                    {t("dashboard.btnUpdateHours")}
                  </Link>
                </Button>
              )}
              {isIndependentTutor && (
                <Button asChild variant="outline">
                  <Link to="/finances">
                    <TrendingUp className="h-4 w-4" />
                    {t("dashboard.btnFinances")}
                  </Link>
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {isIndependentTutor && <TrialCountdownBanner />}
          {isManager && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard label={t("dashboard.cardTutors")} value={tutorCount} icon={Users} to="/people" />
              <StatCard label={t("dashboard.cardStudents")} value={studentCount} icon={Users} to="/people" />
              <StatCard label={t("dashboard.todayLessons")} value={todayLessons.length} icon={CalendarDays} to="/schedule" />
              <div className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-success/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      {t("dashboard.cardProfit")}
                    </p>
                    <Link to="/finances" className="block">
                      <p
                        className={`mt-1 truncate font-display text-lg font-bold sm:text-xl ${
                          profit >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {profit} ₴
                      </p>
                    </Link>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/10">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                  </div>
                </div>
                <Select value={profitPeriod} onValueChange={(v) => setProfitPeriod(v as ProfitPeriod)}>
                  <SelectTrigger className="mt-2 h-7 w-full text-[11px] sm:text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("dashboard.periodAll")}</SelectItem>
                    <SelectItem value="month">{t("dashboard.periodMonth")}</SelectItem>
                    <SelectItem value="week">{t("dashboard.periodWeek")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isIndependentTutor && <TutorWelcomeBanner />}
          {isIndependentTutor && (
            <ReferralNudgeBanner
              completedLessons={myCompletedLessonsCount}
              invitedCount={referralInvitedCount}
            />
          )}
          {isIndependentTutor && <IndependentTutorStats />}
          {isTutor && !isManager && (
            <div className="mt-4">
              <PendingPaymentsCard />
            </div>
          )}
          {isIndependentTutor && (
            <div id="monthly-summary-anchor" className="mt-6 grid gap-4 lg:grid-cols-2">
              <MonthlySummaryCard />
              <ReferralWidget compact />
            </div>
          )}

          {isStudent && !isTutor && !isManager && user && (
            <div className="mt-4">
              <StudentWalletCard studentId={user.id} />
            </div>
          )}

          {/* "До уваги" — past scheduled lessons not yet marked. Manager: across all tutors. Tutor: own only. */}
          {(isManager || (isTutor && !isManager)) && user && (
            <NeedsMarkingCard
              lessons={lessons.filter((l) => {
                if (l.status !== "scheduled") return false;
                if (!isManager && l.tutor_id !== user.id) return false;
                return true;
              })}
              studentNames={profiles}
              onChanged={loadData}
            />
          )}

          <div className={`${isManager || isIndependentTutor ? "mt-8 " : ""}grid gap-4 lg:grid-cols-[1.2fr,0.8fr]`}>
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-foreground">{t("dashboard.upcomingLessons")}</h2>
                {upcomingAll.length > todayPlusTomorrowLessons.length && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAllUpcoming((v) => !v)}
                  >
                    {showAllUpcoming ? t("dashboard.hide") : t("dashboard.showAll", { count: upcomingAll.length })}
                  </Button>
                )}
              </div>
              <div className={`space-y-3 ${showAllUpcoming ? "max-h-[60vh] overflow-y-auto pr-1" : ""}`}>
                {upcomingLessons.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                    {isIndependentTutor && (myStudentCount ?? 0) === 0 ? (
                      <div className="space-y-2">
                        <p className="font-medium text-foreground">👋 Додай першого учня — це займе 2 хвилини</p>
                        <p className="text-xs">Введи ім'я і ставку — далі створиш урок одним кліком.</p>
                        <Button size="sm" className="mt-1" onClick={() => setAddStudentOpen(true)}>
                          <Plus className="h-4 w-4" />
                          Додати першого учня
                        </Button>
                      </div>
                    ) : (
                      <>
                        {t("dashboard.noUpcoming")}
                        {isTutor && !isManager && (
                          <Button asChild size="sm" className="ml-3">
                            <Link to="/schedule">{t("dashboard.btnCreateLesson")}</Link>
                          </Button>
                        )}
                        {isStudent && !isTutor && !isManager && (
                          <span className="ml-3 inline-block">
                            <FindTutorDialog
                              trigger={<Button size="sm">{t("dashboard.btnRequestTutor")}</Button>}
                            />
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  upcomingLessons.map((lesson) => {
                    const isParticipant = user?.id === lesson.tutor_id || user?.id === lesson.student_id;
                    const meetingHref = effectiveMeetingUrl(lesson);
                    const tutorName = profiles[lesson.tutor_id] ?? "—";
                    const studentName = profiles[lesson.student_id] ?? "—";

                    if (isManager && !isParticipant) {
                      return (
                        <LessonCard
                          key={lesson.id}
                          lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                          variant="dashboard"
                          studentName={studentName}
                          tutorName={tutorName}
                          showTutor
                          meetingUrl={meetingHref}
                          onContentClick={() => setOpenLessonId(lesson.id)}
                          extraActions={
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[44px]"
                                onClick={() => setOpenLessonId(lesson.id)}
                              >
                                Відкрити
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                title="Поповнити гаманець"
                                onClick={() =>
                                  setWalletPair({
                                    tutor_id: lesson.tutor_id,
                                    student_id: lesson.student_id,
                                    tutor_name: tutorName,
                                    student_name: studentName,
                                  })
                                }
                              >
                                <Wallet className="h-4 w-4" />
                              </Button>
                            </>
                          }
                        />
                      );
                    }

                    const canTogglePayment =
                      isManager || (user?.id === lesson.tutor_id && lesson.source === "independent");
                    const isPaid = lesson.student_payment_status === "paid";

                    const togglePayment = async () => {
                      const next = isPaid ? "unpaid" : "paid";
                      const { error } = await supabase
                        .from("lesson_details")
                        .upsert({ lesson_id: lesson.id, student_payment_status: next } as any, { onConflict: "lesson_id" });
                      if (error) {
                        // eslint-disable-next-line no-console
                        console.error(error);
                        return;
                      }
                      loadData();
                    };

                    const partnerId =
                      user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id;

                    return (
                      <Collapsible key={lesson.id}>
                        <LessonCard
                          lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                          variant="dashboard"
                          studentName={studentName}
                          tutorName={tutorName}
                          showTutor={isManager}
                          meetingUrl={meetingHref}
                          chatPartnerId={partnerId}
                          onTogglePayment={canTogglePayment ? togglePayment : undefined}
                          extraActions={
                            <CollapsibleTrigger asChild>
                              <Button size="sm" variant="ghost" className="group min-h-[44px]">
                                Деталі
                                <ChevronDown className="ml-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                              </Button>
                            </CollapsibleTrigger>
                          }
                          footer={
                            <CollapsibleContent className="rounded-b-xl border-x border-b border-border bg-card p-4 -mt-px">
                              <LessonWorkspace
                                lessonId={lesson.id}
                                tutorId={lesson.tutor_id}
                                studentId={lesson.student_id}
                                meetingUrl={lesson.meeting_url}
                                homework={lesson.homework}
                                summary={lesson.summary}
                                studentNotes={lesson.student_notes}
                                source={lesson.source}
                                studentPrice={lesson.student_price}
                                studentPaymentStatus={lesson.student_payment_status}
                                lessonStatus={lesson.status}
                                onUpdated={loadData}
                              />
                            </CollapsibleContent>
                          }
                        />
                      </Collapsible>
                    );
                  })
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-4 font-display text-lg font-semibold text-foreground">{t("dashboard.nextSteps")}</h2>
              {isManager ? (
                <div className="space-y-3">
                  <TelegramLinkCard />
                  {smartTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
                        <TrendingUp className="h-4 w-4 text-success" />
                      </div>
                      <p className="text-sm font-medium text-foreground">Усе під контролем 🎉</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Немає термінових задач. Можна планувати наступний тиждень.
                      </p>
                    </div>
                  ) : (
                    smartTasks.map((task) => {
                      const Icon = task.icon;
                      const toneClass =
                        task.tone === "destructive"
                          ? "border-destructive/40 bg-destructive/5"
                          : task.tone === "warning"
                          ? "border-warning/40 bg-warning/5"
                          : "border-primary/40 bg-primary/5";
                      const iconClass =
                        task.tone === "destructive"
                          ? "bg-destructive/10 text-destructive"
                          : task.tone === "warning"
                          ? "bg-warning/10 text-warning"
                          : "bg-primary/10 text-primary";
                      return (
                        <div
                          key={task.key}
                          className={`flex items-start gap-3 rounded-xl border p-4 ${toneClass}`}
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">{task.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                            <Button asChild size="sm" variant="outline" className="mt-3">
                              <Link to={task.to}>{task.cta}</Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <TelegramLinkCard />
                  {isStudent && (
                    <>
                      {studentTutorCount > 0 ? (
                        <div className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                              <CalendarDays className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">Уроки призначає репетитор</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Дату й час нових уроків додає ваш репетитор або менеджер. Якщо потрібен новий час — напишіть репетитору в чаті.
                              </p>
                              <div className="mt-3 flex gap-2">
                                <Button asChild size="sm" variant="outline"><Link to="/schedule">До розкладу</Link></Button>
                                <Button asChild size="sm" variant="ghost"><Link to="/chats">Чати</Link></Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                              <HandHeart className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">Підібрати репетитора</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                У вас ще немає закріпленого репетитора. Залиште запит — менеджер oTutorHub підбере фахівця під ваші цілі, бюджет і графік.
                              </p>
                              <div className="mt-3">
                                <FindTutorDialog
                                  trigger={<Button size="sm">Залишити запит</Button>}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {studentTutorCount > 0 && (
                        <div className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
                              <Users className="h-4 w-4 text-warning" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">Знайти нового репетитора</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Шукаєте додаткового репетитора? Менеджер oTutorHub підбере вам спеціаліста.
                              </p>
                              <div className="mt-3">
                                <FindTutorDialog
                                  trigger={<Button size="sm" variant="outline">Залишити запит</Button>}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {isTutor && <TutorNotesCard />}
                  {(isTutor || isManager) && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <CalendarPlus className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">Оновити доступні години</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Тримайте календар актуальним, щоб учні бачили вільні слоти.
                          </p>
                          <Button asChild size="sm" variant="outline" className="mt-3">
                            <Link to="/availability">Відкрити</Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {isTutor && !isManager && <QuickPaymentFab />}
      {walletPair && (
        <WalletDialog
          open={!!walletPair}
          onOpenChange={(o) => { if (!o) setWalletPair(null); }}
          tutorId={walletPair.tutor_id}
          studentId={walletPair.student_id}
          tutorName={walletPair.tutor_name}
          studentName={walletPair.student_name}
          canTopUp={isManager}
          canDelete={isManager}
        />
      )}
      <QuickAddStudentDialog
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        onCreated={() => loadData()}
      />
      <LessonDetailsDialog
        lessonId={openLessonId}
        open={!!openLessonId}
        onOpenChange={(o) => { if (!o) setOpenLessonId(null); }}
        onUpdated={loadData}
      />
      <AutoCompletePromptDialog enabled={isIndependentTutor} />
    </AppLayout>
  );
}
