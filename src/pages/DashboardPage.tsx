import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { DashboardSkeleton } from "@/components/PageSkeletons";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { FindTutorDialog } from "@/components/FindTutorDialog";
import { TelegramLinkCard } from "@/components/TelegramLinkCard";
import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafe } from "@/lib/lessonDetailsSafe";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { usePaywallTracking } from "@/hooks/usePaywallTracking";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { IndependentTutorStats } from "@/components/IndependentTutorStats";
import { TutorWelcomeBanner } from "@/components/TutorWelcomeBanner";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { ReferralNudgeBanner } from "@/components/ReferralNudgeBanner";
import { StudentWalletCard } from "@/components/StudentWalletCard";
import { WalletDialog } from "@/components/WalletDialog";
import { AiNotesDialog } from "@/components/AiNotesDialog";
import { CloseDayDialog, type CloseDayRow } from "@/components/CloseDayDialog";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";
import { LessonDetailsDialog } from "@/components/LessonDetailsDialog";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { GraduationCap, Sparkles, X, Wallet, CheckCircle2 } from "lucide-react";
import { QuickLessonDialog } from "@/components/QuickLessonDialog";
import { useTutorGamification } from "@/hooks/useTutorGamification";
import { useBadgeUnlockToasts } from "@/hooks/useBadgeUnlockToasts";
import { LessonCard } from "@/components/LessonCard";
import { AddFab } from "@/components/AddFab";
import { TutorNotesCard } from "@/components/TutorNotesCard";
import { NeedsMarkingCard } from "@/components/NeedsMarkingCard";
import { StreakCard } from "@/components/StreakCard";

import { AutoCompleteLessonsCard } from "@/components/AutoCompleteLessonsCard";
import { RecordPaymentSheet, type PairOption, type UnpaidLessonOption } from "@/components/RecordPaymentSheet";
import { PageFAB } from "@/components/PageFAB";
import { SkeletonHero, SkeletonList, SkeletonStatCards } from "@/components/SkeletonCard";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NotificationBell } from "@/components/NotificationBell";
import { lessonSourceTint } from "@/components/SourceBadge";
import { EmptyState } from "@/components/EmptyState";
import { formatPrice } from "@/lib/currency";
import { burstConfetti } from "@/lib/confetti";
import { useHaptic } from "@/hooks/useHaptic";
import { insertNotification } from "@/lib/notifications";
import { notifyGroupLessonCancelled } from "@/lib/groupLessons";
import { isPayoutDueToday, nextPayoutDate, type PayoutSchedule } from "@/lib/payoutSchedule";
import { getRandomEmoji, type RewardTheme } from "@/lib/rewardThemes";
import { DayClosedCelebration } from "@/components/DayClosedCelebration";
import { TopTutorBadge } from "@/components/TopTutorBadge";
import {
  CalendarDays,
  Users,
  TrendingUp,
  Loader2,
  Video,
  AlertTriangle,
  Inbox,
  Crown,
  MessageSquare,
  UserX,
  Tag,
  CalendarPlus,
  StickyNote,
  Plus,
  HandHeart,
  Clock,
  ChevronRight,
  Bell,
  Menu,
  UserCircle,
  RefreshCw,
} from "lucide-react";

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

const dayAffirmations = [
  "Я спокійно керую своїм днем і бачу головне.",
  "Я створюю ясність для себе, учнів і команди.",
  "Мій розклад допомагає мені працювати без хаосу.",
  "Я встигаю достатньо, коли рухаюся по одному кроку.",
  "Я маю право на спокійний темп і якісний результат.",
  "Мої уроки приносять користь і відчутний прогрес.",
  "Я тримаю фокус на людях, а не на рутині.",
  "Я можу делегувати системі те, що не потребує моєї уваги.",
  "Я бачу фінанси чітко і приймаю впевнені рішення.",
  "Я будую навчання, у якому всім зрозуміло, що далі.",
  "Мій досвід цінний, і він щодня допомагає іншим.",
  "Я не мушу робити все одразу, щоб рухатися вперед.",
  "Я помічаю маленькі перемоги і дозволяю їм підтримувати мене.",
  "Я працюю професійно, навіть коли день насичений.",
  "Мій час має цінність, і я ставлюся до нього з повагою.",
  "Я можу сказати “достатньо” і завершити день без провини.",
  "Я веду учнів до результату через стабільність і турботу.",
  "Мені доступні прості рішення для складних процесів.",
  "Я обираю ясні правила замість постійного напруження.",
  "Кожен впорядкований урок робить систему сильнішою.",
  "Я впевнено бачу, що потребує моєї уваги сьогодні.",
  "Моя робота стає легшою, коли дані зібрані в одному місці.",
  "Я заслуговую на інструменти, які бережуть мою енергію.",
  "Я можу підтримувати високий стандарт без перевантаження.",
  "Я створюю простір, де навчання й організація працюють разом.",
  "Я дозволяю собі працювати розумніше, не більше.",
  "Мій день може бути продуктивним і спокійним одночасно.",
  "Я приймаю рішення на основі фактів, а не тривоги.",
  "Я ціную свій вклад і бачу його результат.",
  "Мої учні отримують структуру, підтримку і зрозумілий шлях.",
  "Я можу швидко повернути контроль, коли день змінюється.",
  "Я підтримую порядок маленькими діями щодня.",
  "Я не втрачаю важливе — система допомагає мені пам’ятати.",
  "Я маю достатньо ресурсу для головних розмов і рішень.",
  "Я вмію бачити пріоритети серед багатьох задач.",
  "Моя організованість підсилює довіру учнів і батьків.",
  "Я можу працювати прозоро, чесно і без зайвих пояснень.",
  "Я даю собі право на паузу, коли вона потрібна.",
  "Я зростаю як фахівець через сталість, а не поспіх.",
  "Кожен урок — це вклад у майбутній результат.",
  "Я тримаю фінансові процеси чистими і зрозумілими.",
  "Я легко повертаюся до плану після будь-якого збою.",
  "Я створюю систему, яка працює не тільки сьогодні, а й завтра.",
  "Я можу бути уважною/уважним до деталей без виснаження.",
  "Я обираю спокійну впевненість замість хаотичної зайнятості.",
  "Моя команда й учні виграють від ясного процесу.",
  "Я знаю, що наступний правильний крок уже достатній.",
  "Я не зобов’язана/зобов’язаний носити весь хаос у голові.",
  "Я будую навчальний простір, де відповідальність розподілена чесно.",
  "Я можу змінювати план і все одно рухатися до цілі.",
  "Я бачу прогрес навіть у тих речах, які ще не ідеальні.",
  "Я маю право на інтерфейс, який допомагає, а не заважає.",
  "Я веду справи так, щоб завтра було легше, ніж сьогодні.",
  "Я помічаю ризики вчасно і дію без паніки.",
  "Мій професіоналізм проявляється у ясності, турботі й межах.",
  "Я можу просити оплату спокійно, бо моя праця має цінність.",
  "Я не відкладаю важливе, коли бачу його чітко.",
  "Я створюю ритм, у якому учням легше триматися курсу.",
  "Я можу бути послідовною/послідовним без жорсткості до себе.",
  "Мій день складається з керованих частин, а не з безладу.",
  "Я відпускаю зайву ручну рутину і повертаю увагу якості.",
  "Я гідно завершую задачі й не тягну їх подумки весь день.",
  "Я бачу, де потрібна дія, а де достатньо спостерігати.",
  "Я створюю довіру через передбачуваність і чесні правила.",
  "Мій календар — це підтримка, а не тиск.",
  "Я дозволяю собі робити складні речі простими кроками.",
  "Я можу бути ефективною/ефективним без поспіху.",
  "Я зберігаю фокус на результаті учня, не гублячи себе.",
  "Я керую процесами, а не процеси керують мною.",
  "Я щодня покращую систему маленькими точними рішеннями.",
  "Мої нотатки, оплати й уроки мають своє місце.",
  "Я можу довіряти порядку, який створюю.",
  "Я з повагою ставлюся до свого часу і часу інших.",
  "Я не плутаю завантаженість із цінністю своєї роботи.",
  "Я обираю робочий день, після якого залишається енергія.",
  "Я підтримую учнів не тільки знаннями, а й структурою.",
  "Я бачу ширшу картину і не гублю важливі деталі.",
  "Я можу завершити день із відчуттям опори.",
  "Я створюю процеси, які зменшують кількість зайвих повідомлень.",
  "Я працюю впевнено, бо маю прозору картину справ.",
  "Я не мушу пам’ятати все — достатньо мати надійну систему.",
  "Я приймаю себе в реальному темпі реального дня.",
  "Я здатна/здатний тримати межі й залишатися турботливою/турботливим.",
  "Мої рішення сьогодні роблять завтрашній день легшим.",
  "Я даю учням якість, а собі — порядок і спокій.",
  "Я можу розвивати справу без постійного внутрішнього шуму.",
  "Я бачу, що вже працює, і підсилюю це.",
  "Я обираю ясність, послідовність і людяність.",
  "Мій день має напрям, навіть якщо в ньому багато змін.",
  "Я справляюся — крок за кроком, урок за уроком.",
];

type ProfitPeriod = "all" | "month" | "week";

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const { user, roles, loading: authLoading } = useAuth();
  const { isIndependent, settings, loading: wsLoading, isTrial, isPro, trialDaysLeft, trialUntil } = useWorkspaceSettings();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isStudent = roles.includes("student");
  const { trackPaywallClick } = usePaywallTracking();
  const [openingManagerChat, setOpeningManagerChat] = useState(false);

  // "Менеджер хабу" — open (or create) the hub tutor ↔ manager support chat,
  // using the existing chat system (start_manager_chat resolves the single
  // manager + ensures the thread; ChatsPage selects it via ?with=).
  const openManagerChat = async () => {
    trackPaywallClick("hub_manager_chat", "dashboard");
    setOpeningManagerChat(true);
    const { data, error } = await (supabase as any).rpc("start_manager_chat");
    setOpeningManagerChat(false);
    if (error || !data) {
      toast.error(t("dashboard.hubManagerFailed"));
      return;
    }
    navigate(`/chats?with=${data}`);
  };
  const isIndependentTutor = isTutor && !isManager && isIndependent;
  // Hub tutor = tutor who belongs to a hub (not a manager, not independent).
  const isHubTutor = isTutor && !isManager && !isIndependentTutor;

  // Student-only users belong on /student-dashboard. Redirect them out of
  // the tutor/manager dashboard immediately to avoid mixed UI.
  useEffect(() => {
    if (isStudent && !isManager && !isTutor) {
      navigate("/student-dashboard", { replace: true });
    }
  }, [isStudent, isManager, isTutor, navigate]);

  // First-session redirect: new tutor (independent OR hub) → /onboarding.
  // Source of truth: Supabase onboarding_completed field. The onboarding flow itself
  // renders the role-appropriate subset of steps (hub tutors get a lighter set).
  // sessionStorage prevents repeated redirects within the same browser session
  // but a new device/browser will always redirect until onboarding is done.
  useEffect(() => {
    if (wsLoading || !user || !isTutor || isManager || !settings) return;
    if (settings.onboarding_completed) return;
    const sessionKey = `onboarding_redirected_${user.id}`;
    if (sessionStorage.getItem(sessionKey) === "1") return;
    sessionStorage.setItem(sessionKey, "1");
    navigate("/onboarding", { replace: true });
  }, [wsLoading, user?.id, isTutor, isManager, settings, navigate]);

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  // Group lessons (student_id NULL) carry payment per-participant on lesson_participants,
  // not on the lesson row — track which ones still have an unpaid participant.
  const [groupUnpaidLessonIds, setGroupUnpaidLessonIds] = useState<Set<string>>(new Set());
  const [payoutSchedules, setPayoutSchedules] = useState<Array<{ user_id: string; name: string; payout_frequency: string | null; payout_weekday: number | null; payout_monthday: number | null; payout_anchor: string | null }>>([]);
  const [payingTutor, setPayingTutor] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tutorCount, setTutorCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [tutorReferralRequestCount, setTutorReferralRequestCount] = useState(0);
  const [supportRequestCount, setSupportRequestCount] = useState(0);
  const [feedbackNewCount, setFeedbackNewCount] = useState(0);
  const [studentsWithoutTutor, setStudentsWithoutTutor] = useState(0);
  const [studentTutorCount, setStudentTutorCount] = useState(0);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [walletPair, setWalletPair] = useState<{ tutor_id: string; student_id: string; tutor_name: string; student_name: string } | null>(null);
  const [aiNotesOpen, setAiNotesOpen] = useState(false);
  const [closeDayOpen, setCloseDayOpen] = useState(false);
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [paymentPairs, setPaymentPairs] = useState<PairOption[]>([]);
  const [paymentUnpaid, setPaymentUnpaid] = useState<UnpaidLessonOption[]>([]);
  // Pending-payment cards currently animating OUT (marked paid) — kept rendered briefly
  // so the manager SEES them leave instead of an instant vanish.
  const [exitingPay, setExitingPay] = useState<Record<string, any>>({});
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  // Default to THIS MONTH — the profit bubble is a "this month" metric, not lifetime
  // ("За весь час" misread as monthly). Applies to every role's profit card.
  const [profitPeriod, setProfitPeriod] = useState<ProfitPeriod>("month");
  const [myStudentCount, setMyStudentCount] = useState<number | null>(null);
  // Hub tutor (source "hub", in a hub): own payout schedule + own per-lesson rate
  // + count of hub students. PRIVACY: never load/derive student_price or hub margin.
  const [hubPayoutSchedule, setHubPayoutSchedule] = useState<PayoutSchedule | null>(null);
  const [hubRate, setHubRate] = useState<number | null>(null);
  const [hubStudentCount, setHubStudentCount] = useState<number | null>(null);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [quickLessonOpen, setQuickLessonOpen] = useState(false);
  const [showDayClosed, setShowDayClosed] = useState(false);
  const [dayClosedCount, setDayClosedCount] = useState(0);
  const [topPercentile, setTopPercentile] = useState<number | null>(null);

  const [defaultMeetingUrls, setDefaultMeetingUrls] = useState<Record<string, string>>({});
  const [pairCurrency, setPairCurrency] = useState<Record<string, string>>({});

  // Gamification: badge unlock toasts + streak card + referral nudge counters
  const gamification = useTutorGamification();
  const { badges, loading: gamificationLoading, streak, level } = gamification;

  // Onboarding bonus progress for "Що зробити далі" section
  const obProgress = useOnboardingProgress();
  const [skippedTasks, setSkippedTasks] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("ob_skipped_dashboard") ?? "[]"); } catch { return []; }
  });
  const skipTask = (action: string) => {
    const next = [...skippedTasks, action];
    setSkippedTasks(next);
    localStorage.setItem("ob_skipped_dashboard", JSON.stringify(next));
  };

  // Pull-to-refresh on mobile
  const { isPulling, pullProgress } = usePullToRefresh(() => loadData());
  useBadgeUnlockToasts(badges, gamificationLoading);

  // "Сьогодні день X твоєї серії" — once per day greeting
  useEffect(() => {
    if (!streak || !user || !isTutor || gamificationLoading) return;
    if ((streak.current_streak ?? 0) <= 0) return;
    const todayKey = `streak_greeted_${user.id}_${new Date().toDateString()}`;
    if (localStorage.getItem(todayKey)) return;
    localStorage.setItem(todayKey, todayKey);
    const count = streak.current_streak;
    toast(t("tutorDelight.streakDayToast", { count }), {
      description: count >= 7
        ? t("tutorDelight.streakDayDesc7plus")
        : t("tutorDelight.streakDayDesc"),
      duration: 5000,
      icon: "🔥",
    });
  }, [streak?.current_streak, user?.id, isTutor, gamificationLoading]);
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
    const months = t("dashboardExtra.months").split(",");
    const prevMonthIdx = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    import("sonner").then(({ toast }) => {
      toast(`🎉 ${t("monthlySummaryExtra.greetingNoName", { month: months[prevMonthIdx] })} готовий!`, {
        description: t("dashboardExtra.monthlySummaryDesc"),
        duration: 8000,
        action: {
          label: t("dashboardExtra.monthlySummaryBtn"),
          onClick: () => {
            const el = document.getElementById("monthly-summary-anchor");
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          },
        },
      });
    });
    localStorage.setItem(seenKey, "1");
  }, [user?.id, isIndependentTutor]);



  const openPaymentSheet = async () => {
    if (!user) return;
    setPaymentSheetOpen(true);
    // Load the tutor's student pairs (all sources) + unpaid billable lessons.
    const [{ data: rates }, { data: details }] = await Promise.all([
      supabase
        .from("student_rates")
        .select("tutor_id, student_id, price_per_lesson, archived_at")
        .eq("tutor_id", user.id),
      // Read via lessons_visible (security_invoker view): for a HUB tutor it returns
      // student_price = NULL and student_payment_status = NULL, so the unpaid filter
      // matches nothing — a hub tutor never receives the hub's student_price here.
      supabase
        .from("lessons_visible")
        .select("id, starts_at, subject, student_id, tutor_id, status, student_price, student_payment_status")
        .eq("tutor_id", user.id)
        .eq("student_payment_status", "unpaid")
        .neq("status", "cancelled")
        .neq("status", "pending")
        .limit(200),
    ]);

    const activeRates = (rates ?? []).filter((r: { archived_at: string | null }) => !r.archived_at);
    const studentIds = Array.from(new Set(activeRates.map((r: { student_id: string }) => r.student_id)));
    // Fetch any names we don't already have cached in `profiles`.
    const missing = studentIds.filter((id) => !profiles[id]);
    const nameOf: Record<string, string> = { ...profiles };
    if (missing.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", missing);
      (profs ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null }) => {
        nameOf[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
      });
    }

    const rateByStudent = new Map<string, number>();
    activeRates.forEach((r: { student_id: string; price_per_lesson: number | null }) => {
      if (!rateByStudent.has(r.student_id)) rateByStudent.set(r.student_id, Number(r.price_per_lesson ?? 0));
    });

    const pairs: PairOption[] = studentIds
      .map((sid) => ({
        tutor_id: user.id,
        student_id: sid,
        tutor_name: nameOf[user.id] ?? "",
        student_name: nameOf[sid] ?? "—",
        rate: rateByStudent.get(sid),
      }))
      .sort((a, b) => a.student_name.localeCompare(b.student_name, "uk"));
    setPaymentPairs(pairs);

    const unpaid: UnpaidLessonOption[] = ((details ?? []) as Array<{
      id: string; starts_at: string; subject: string; student_id: string; tutor_id: string; student_price: number | null;
    }>).map((d) => ({
      id: d.id,
      subject: d.subject,
      starts_at: d.starts_at,
      student_price: Number(d.student_price ?? 0),
      student_id: d.student_id,
      tutor_id: d.tutor_id,
    }));
    setPaymentUnpaid(unpaid);
  };

  const markPaymentLessonPaid = async (lessonId: string) => {
    await updateLessonDetailsSafe(lessonId, {
      student_payment_status: "paid",
      student_paid_at: new Date().toISOString(),
    });
    setPaymentUnpaid((prev) => prev.filter((l) => l.id !== lessonId));
    loadData();
  };

  const loadData = async () => {
    // Wait for auth to finish — prevents new users from seeing stale/other users' data
    if (!user || authLoading) return;
    // New user with no roles yet — don't load — show empty state
    if (roles.length === 0) { setLoading(false); return; }

    const [
      { data: lessonsData, error: lessonsError },
      { data: profilesData },
      { data: rolesData },
      { data: requestRows },
      { data: ratesData },
      { data: defaultsData },
      { data: ratesCurrencyData },
    ] = await Promise.all([
      (() => {
        let q = supabase
          .from("lessons_visible")
          .select("id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, tutor_payout, student_payment_status, tutor_payout_status, meeting_url, homework, summary, student_notes, source")
          .gte("starts_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())  // last 30 days
          .lte("starts_at", new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString())  // next 14 days
          .limit(150);
        if (isManager) q = (q as any).neq("source", "independent");
        return q.order("starts_at", { ascending: true });
      })(),
      supabase.from("profiles").select("id, first_name, last_name").limit(300),
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

    if (lessonsError) {
      toast.error(t("dashboardExtra.loadFailed"));
      setLoading(false);
      return;
    }

    const currencyMap: Record<string, string> = {};
    ((ratesCurrencyData ?? []) as Array<{ tutor_id: string; student_id: string; currency: string | null }>).forEach((r) => {
      currencyMap[`${r.tutor_id}:${r.student_id}`] = r.currency ?? "UAH";
    });
    setPairCurrency(currencyMap);


    const profileMap: Record<string, string> = {};
    (profilesData as ProfileRow[] | null ?? []).forEach((profile) => {
      profileMap[profile.id] = `${profile.first_name} ${profile.last_name}`.trim() || t("shared.noName");
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
      const [{ count: trCount }, { count: srCount }, { count: fbCount }] = await Promise.all([
        supabase
          .from("tutor_referral_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]),
        supabase
          .from("subscription_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["new", "in_progress"]),
        supabase
          .from("feedback_submissions")
          .select("id", { count: "exact", head: true })
          .eq("status", "new"),
      ]);
      setTutorReferralRequestCount(trCount ?? 0);
      setSupportRequestCount(srCount ?? 0);
      setFeedbackNewCount(fbCount ?? 0);
    }

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

    // Group lessons have no shared lesson_details row; their pending state lives on
    // lesson_participants. Flag group lessons (in the loaded set) with ≥1 unpaid
    // participant so the pending-payments section surfaces them too. RLS scopes
    // participants to the current manager/tutor.
    const groupLessonIds = uniqueLessons.filter((l) => !l.student_id).map((l) => l.id);
    if (groupLessonIds.length) {
      const { data: gParts } = await supabase
        .from("lesson_participants")
        .select("lesson_id, student_payment_status")
        .in("lesson_id", groupLessonIds)
        .eq("student_payment_status", "unpaid");
      setGroupUnpaidLessonIds(new Set(((gParts ?? []) as Array<{ lesson_id: string }>).map((p) => p.lesson_id)));
    } else {
      setGroupUnpaidLessonIds(new Set());
    }
    if (isManager) {
      try {
        const { data: sched, error: schedErr } = await supabase
          .from("tutor_details")
          .select("user_id, payout_frequency, payout_weekday, payout_monthday, payout_anchor")
          .not("payout_frequency", "is", null);
        if (!schedErr && sched && sched.length) {
          const ids = (sched as any[]).map((r) => r.user_id);
          const { data: profs } = await supabase.from("profiles").select("id, first_name, last_name").in("id", ids);
          const nameMap: Record<string, string> = {};
          (profs ?? []).forEach((pr: any) => { nameMap[pr.id] = `${pr.first_name ?? ""} ${pr.last_name ?? ""}`.trim() || "Репетитор"; });
          setPayoutSchedules((sched as any[]).map((r) => ({ ...r, name: nameMap[r.user_id] ?? "Репетитор" })));
        } else {
          setPayoutSchedules([]);
        }
      } catch {
        // Колонки графіка ще не створені (Частина 1 SQL не застосована) — тихо пропускаємо
        setPayoutSchedules([]);
      }
    }

    if (isIndependentTutor) {
      const { count } = await supabase
        .from("student_rates")
        .select("student_id", { count: "exact", head: true })
        .eq("tutor_id", user.id)
        .eq("source", "independent");
      setMyStudentCount(count ?? 0);
    }

    // Hub tutor: own payout schedule + own per-lesson rate (tutor_details, keyed
    // by user_id) and count of hub students. PRIVACY: tutor_details holds only the
    // tutor's own data — no student_price / hub margin is ever touched here.
    if (isHubTutor) {
      try {
        const { data: td } = await supabase
          .from("tutor_details")
          .select("rate_per_lesson, payout_frequency, payout_weekday, payout_monthday, payout_anchor")
          .eq("user_id", user.id)
          .maybeSingle();
        if (td) {
          setHubRate(td.rate_per_lesson != null ? Number(td.rate_per_lesson) : null);
          setHubPayoutSchedule({
            payout_frequency: (td as any).payout_frequency ?? null,
            payout_weekday: (td as any).payout_weekday ?? null,
            payout_monthday: (td as any).payout_monthday ?? null,
            payout_anchor: (td as any).payout_anchor ?? null,
          });
        }
      } catch {
        // Колонки графіка ще не створені — тихо пропускаємо.
        setHubPayoutSchedule(null);
      }
      const { count } = await supabase
        .from("student_rates")
        .select("student_id", { count: "exact", head: true })
        .eq("tutor_id", user.id)
        .neq("source", "independent");
      setHubStudentCount(count ?? 0);
    }

    // Top-10% calculation — compare tutor's lesson count vs all tutors this month
    if (isTutor && !isManager) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const iso = monthStart.toISOString();
      const [{ count: myCount }, { count: totalTutors }, { data: topRows }] = await Promise.all([
        supabase.from("lessons").select("id", { count: "exact", head: true })
          .eq("tutor_id", user.id).eq("status", "completed").gte("starts_at", iso),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "tutor"),
        supabase.from("lessons").select("tutor_id").eq("status", "completed").gte("starts_at", iso),
      ]);
      if (myCount && myCount > 0 && totalTutors && totalTutors > 1 && topRows) {
        const countByTutor: Record<string, number> = {};
        (topRows as { tutor_id: string }[]).forEach((r) => {
          countByTutor[r.tutor_id] = (countByTutor[r.tutor_id] ?? 0) + 1;
        });
        const tutorsAbove = Object.values(countByTutor).filter((c) => c > myCount!).length;
        setTopPercentile((tutorsAbove / totalTutors!) * 100);
      }
    }

    setLoading(false);
  };

  const updateStatus = async (lessonId: string, newStatus: LessonStatus) => {
    const { error } = await supabase.from("lessons").update({ status: newStatus }).eq("id", lessonId);
    if (error) {
      toast.error(t("dashboardExtra.statusChangeFailed"));
      return;
    }
    const updatedLessons = lessons.map((l) => (l.id === lessonId ? { ...l, status: newStatus } : l));
    setLessons(updatedLessons);

    // Day-closed celebration — check if all today's lessons are done
    if ((newStatus === "completed" || newStatus === "cancelled") && isTutor && user) {
      const todayStr = new Date().toDateString();
      const storageKey = `day_closed_${user.id}_${todayStr}`;
      if (!localStorage.getItem(storageKey)) {
        const todayLessons = updatedLessons.filter((l) => {
          const lessonTutor = isTutor && !isManager ? l.tutor_id === user.id : true;
          return new Date(l.starts_at).toDateString() === todayStr && lessonTutor;
        });
        const allDone =
          todayLessons.length > 0 &&
          todayLessons.every((l) => l.status === "completed" || l.status === "cancelled");
        if (allDone) {
          localStorage.setItem(storageKey, "1");
          const completedCount = todayLessons.filter((l) => l.status === "completed").length;
          setDayClosedCount(completedCount);
          setShowDayClosed(true);
        }
      }
    }
    if (newStatus === "completed") {
      haptic.success();
      // First-ever completion gets its own escalated milestone moment (one-time,
      // gated by localStorage like the day-closed celebration).
      const completedBefore = lessons.filter((l) => l.status === "completed").length;
      const firstKey = user ? `first_lesson_done_${user.id}` : "";
      const isFirstLesson = !!firstKey && completedBefore === 0 && !localStorage.getItem(firstKey);
      if (isFirstLesson) {
        localStorage.setItem(firstKey, "1");
        burstConfetti({ count: 40, originY: 40 });
      } else {
        burstConfetti();
      }
      const lesson = lessons.find((l) => l.id === lessonId);
      const canMarkPay = !!lesson && lesson.student_payment_status !== "paid" && (isManager || lesson.tutor_id === user?.id);
      toast.success(
        isFirstLesson ? t("dashboardExtra.firstLessonToast") : t("dashboardExtra.lessonCompletedToast"),
        {
          description: canMarkPay
            ? t("dashboardExtra.studentPaidQuestion")
            : streak?.current_streak
              ? t("dashboardExtra.lessonCompletedStreak", { count: streak.current_streak })
              : t("dashboardExtra.lessonCompletedGood"),
          duration: canMarkPay ? 6000 : 4000,
          action: canMarkPay
            ? { label: t("dashboardExtra.paidAction"), onClick: () => updatePayment(lessonId, "student_payment_status", "paid" as PaymentStatus) }
            : undefined,
        },
      );
      gamification.refresh();

      // Award reward emoji to student
      if (lesson?.student_id && user) {
        const theme: RewardTheme = "fruits";
        const emoji = getRandomEmoji(theme);
        const rewardsDb = supabase as any;
        rewardsDb.from("student_rewards").insert({
          student_id: lesson.student_id,
          lesson_id: lessonId,
          tutor_id: user.id,
          emoji,
          theme,
        });
      }
    }
    if (newStatus === "cancelled") {
      const lesson = lessons.find((l) => l.id === lessonId);
      if (lesson?.student_id) {
        insertNotification({
          userId: lesson.student_id,
          type: "lesson_cancelled",
          title: t("notifications.lessonCancelledTitle", { subject: lesson.subject }),
          link: "/student/schedule",
        });
      } else if (lesson) {
        // Group lesson (student_id NULL): fan out to every participant.
        void notifyGroupLessonCancelled(lessonId, lesson.subject);
      }
    }
  };

  const updatePayment = async (
    lessonId: string,
    field: "student_payment_status" | "tutor_payout_status",
    value: PaymentStatus,
  ) => {
    // Group lessons have no shared lesson_details row — per-participant payments are
    // marked in the lesson dialog (lesson_participants). Never write a bogus shared row.
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson?.student_id) return;
    const paidAtField = field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";
    // OPTIMISTIC + HAPTIC FIRST so the tap is felt and seen INSTANTLY (no dead ~2s wait
    // while the DB round-trips, then a confusing blink). Revert if the write fails.
    const prevLessons = lessons;
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, [field]: value } : l)));
    if (value === "paid") haptic.success();
    else haptic.tap();
    const { error } =
      field === "student_payment_status"
        ? await updateLessonDetailsSafe(lessonId, {
            student_payment_status: value,
            student_paid_at: value === "paid" ? new Date().toISOString() : null,
          })
        : await supabase.rpc("set_lesson_tutor_payout_status", { _lesson_id: lessonId, _status: value });
    if (error) {
      setLessons(prevLessons); // revert the optimistic change
      haptic.error();
      toast.error(t("dashboardExtra.paymentFailed"));
      return;
    }
    if (value === "paid" && field === "student_payment_status" && lesson) {
      if (lesson.student_price > 0) {
        const firstName = profiles[lesson.student_id]?.split(" ")[0] ?? t("shared.student");
        const currency = pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] ?? "UAH";
        toast.success(
          t("dashboardExtra.paymentReceivedToast", {
            amount: formatPrice(lesson.student_price, currency, { decimals: 0 }),
            name: firstName,
          }),
          {
            duration: 5000,
            description: t("dashboardExtra.paymentCheckFinances"),
            action: { label: t("nav.finances"), onClick: () => navigate("/finances") },
          },
        );
      }
    }
    if (value === "paid" && field === "tutor_payout_status" && lesson?.tutor_id) {
      const currency = pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] ?? "UAH";
      const amount = formatPrice(lesson.tutor_payout, currency, { decimals: 0 });
      insertNotification({
        userId: lesson.tutor_id,
        type: "payout_confirmed",
        title: t("notifications.payoutConfirmedTitle", { amount }),
        link: "/finances",
      });
    }
  };

  // Mark a pending-payment card paid WITH a visible exit: keep it on screen ~600ms with a
  // slide-out animation (so the manager sees it leave + reads the toast), then drop it.
  const markPendingPaid = (lesson: any) => {
    setExitingPay((e) => ({ ...e, [lesson.id]: lesson }));
    void updatePayment(lesson.id, "student_payment_status", "paid" as PaymentStatus);
    window.setTimeout(() => {
      setExitingPay((e) => {
        const n = { ...e };
        delete n[lesson.id];
        return n;
      });
    }, 600);
  };

  const markPayoutPaid = async (tutorId: string) => {
    setPayingTutor(tutorId);
    // Optimistic UI + instant haptic FIRST (binding invariant), then the RPC; revert on error.
    const prevLessons = lessons;
    setLessons((prev) => prev.map((l) => (l.tutor_id === tutorId && l.tutor_payout_status === "unpaid" ? { ...l, tutor_payout_status: "paid" as PaymentStatus } : l)));
    haptic.success();
    const { data, error } = await supabase.rpc("mark_tutor_payouts_paid" as any, { _tutor_id: tutorId });
    setPayingTutor(null);
    if (error) {
      setLessons(prevLessons);
      haptic.error();
      toast.error(t("dashboardPageExtra.payoutMarkFailed"), { description: error.message });
      return;
    }
    toast.success(t("dashboardPageExtra.payoutMarked"), { description: t("dashboardPageExtra.payoutMarkedDesc", { count: data ?? 0 }) });
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

  // Кінець тріалу: персональні цифри місяця для банера
  const trialStats = useMemo(() => {
    const now = new Date();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let done = 0, earned = 0;
    lessons.forEach((l) => {
      const ts = new Date(l.starts_at).getTime();
      if (ts < mStart) return;
      if (l.status === "completed") done += 1;
      if (l.student_payment_status === "paid") earned += Number(l.student_price) || 0;
    });
    return { done, earned };
  }, [lessons]);
  const [trialBannerHidden, setTrialBannerHidden] = useState(false);
  const trialBannerKey = user ? `trial_banner_${user.id}_${todayKey}` : "";
  const showTrialBanner =
    isIndependent && isTrial && trialDaysLeft <= 5 && !trialBannerHidden &&
    !!trialBannerKey && !localStorage.getItem(trialBannerKey);

  // «Закрити день»: сьогоднішні минулі уроки, що досі в статусі "заплановано"
  const closeDayRows: CloseDayRow[] = useMemo(
    () =>
      todayLessons
        .filter(
          (l) =>
            l.status === "scheduled" &&
            new Date(l.starts_at).getTime() <= nowMs &&
            (isManager || l.tutor_id === user?.id)
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((l) => ({
          id: l.id,
          student_id: l.student_id,
          name: profiles[l.student_id] ?? "Учень",
          time: new Date(l.starts_at).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" }),
          price: Number(l.student_price) || 0,
          currency: pairCurrency[`${l.tutor_id}:${l.student_id}`],
          paid: l.student_payment_status === "paid",
        })),
    [todayLessons, nowMs, isManager, user?.id, profiles, pairCurrency]
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

  // Real month-over-month growth — no more hardcoded +12%
  const prevMonthProfit = useMemo(() => {
    const now = new Date();
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const prevEnd   = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const prev = lessons.filter((l) => {
      if (l.status === "cancelled" || l.status === "pending") return false;
      const ts = new Date(l.starts_at).getTime();
      return ts >= prevStart && ts < prevEnd;
    });
    const inc = prev.filter((l) => l.student_payment_status === "paid")
      .reduce((s, l) => s + Number(l.student_price), 0);
    const exp = prev.filter((l) => l.tutor_payout_status === "paid")
      .reduce((s, l) => s + Number(l.tutor_payout), 0);
    return inc - exp;
  }, [lessons]);

  const profitGrowthPct = useMemo(() => {
    if (profitPeriod !== "month") return null;
    if (prevMonthProfit <= 0) return null; // need a positive prior-month base for a meaningful %
    return Math.round(((profit - prevMonthProfit) / Math.abs(prevMonthProfit)) * 100);
  }, [profit, prevMonthProfit, profitPeriod]);

  // Real monthly PROFIT bars (last 6 months) for the PROFIT card chart.
  // Matches the headline metric (profit = paid income − paid payout) and its
  // monthly framing. Previously this showed 7 weeks of GROSS INCOME, which
  // mismatched both the metric (income ≠ profit for a hub) and the timeframe
  // (weekly under a "this month" card) — the source of the "graph is wrong" bug.
  const monthlyProfitBars = useMemo(() => {
    const now = new Date();
    const vals = Array.from({ length: 6 }, (_, m) => {
      const ms = new Date(now.getFullYear(), now.getMonth() - (5 - m), 1).getTime();
      const me = new Date(now.getFullYear(), now.getMonth() - (5 - m) + 1, 1).getTime();
      const inMonth = lessons.filter((l) => {
        if (l.status === "cancelled" || l.status === "pending") return false;
        const ts = new Date(l.starts_at).getTime();
        return ts >= ms && ts < me;
      });
      const inc = inMonth
        .filter((l) => l.student_payment_status === "paid")
        .reduce((s, l) => s + Number(l.student_price), 0);
      const exp = inMonth
        .filter((l) => l.tutor_payout_status === "paid")
        .reduce((s, l) => s + Number(l.tutor_payout), 0);
      return inc - exp;
    });
    const max = Math.max(...vals, 1);
    return vals.map((v) => Math.round((Math.max(v, 0) / max) * 100));
  }, [lessons]);

  const pendingPayments = useMemo(
    () =>
      lessons.filter((l) => {
        if (l.status === "cancelled" || l.status === "pending") return false;
        const isPast = new Date(l.starts_at).getTime() < nowMs;
        const counts = l.status === "completed" || isPast;
        if (!counts) return false;
        // Group lesson: pending if any participant is unpaid (per-participant billing).
        if (!l.student_id) return groupUnpaidLessonIds.has(l.id);
        // Independent lessons carry NO tutor payout (the tutor collects from the student
        // directly), so tutor_payout_status is permanently "unpaid" there — only the
        // student side counts. Hub lessons count either side (student→hub or hub→tutor).
        return (
          l.student_payment_status === "unpaid" ||
          (l.source !== "independent" && l.tutor_payout_status === "unpaid")
        );
      }),
    [lessons, nowMs, groupUnpaidLessonIds]
  );

  const lessonsWithoutPrice = useMemo(
    () =>
      lessons.filter(
        (l) =>
          // Group lessons (student_id NULL) price per-participant on group_enrollments,
          // not on the lesson row — never count them as "needs a price".
          l.student_id &&
          (l.status === "scheduled" || l.status === "completed") &&
          // Independent lessons have no tutor_payout (it stays 0 by design), so a 0
          // payout must NOT flag them as "missing a price" — only the student price does.
          (Number(l.student_price) === 0 ||
            (l.source !== "independent" && Number(l.tutor_payout) === 0))
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
    all: t("dashboardExtra.periodAll"),
    month: t("dashboardExtra.periodMonth"),
    week: t("dashboardExtra.periodWeek"),
  };

  // ── Hub tutor: «До виплати від хабу» ──────────────────────────────────────
  // Sum of the tutor's OWN tutor_payout for unpaid/pending billable lessons.
  // PRIVACY: only tutor_payout is read here — student_price is null for hub
  // tutors at the DB level and is never referenced.
  const hubPayoutDue = useMemo(() => {
    if (!isHubTutor || !user) return 0;
    return lessons
      .filter(
        (l) =>
          l.tutor_id === user.id &&
          l.status !== "cancelled" &&
          l.status !== "pending" &&
          l.tutor_payout_status === "unpaid",
      )
      .reduce((sum, l) => sum + (Number(l.tutor_payout) || 0), 0);
  }, [isHubTutor, lessons, user?.id]);

  // How many lessons make up the "до виплати" sum (for the premium payout card chip).
  const hubPayoutLessonsCount = useMemo(() => {
    if (!isHubTutor || !user) return 0;
    return lessons.filter(
      (l) =>
        l.tutor_id === user.id &&
        l.status !== "cancelled" &&
        l.status !== "pending" &&
        l.tutor_payout_status === "unpaid",
    ).length;
  }, [isHubTutor, lessons, user?.id]);

  // Next payout date from the tutor's own schedule (null if no schedule set).
  const hubNextPayout = useMemo(
    () => (hubPayoutSchedule ? nextPayoutDate(hubPayoutSchedule) : null),
    [hubPayoutSchedule],
  );

  const hubLessonsTodayCount = useMemo(() => {
    if (!isHubTutor || !user) return 0;
    return todayLessons.filter((l) => l.tutor_id === user.id).length;
  }, [isHubTutor, todayLessons, user?.id]);


  const firstName = useMemo(() => {
    const fromProfile = user?.id ? profiles[user.id]?.split(" ")[0] : "";
    return fromProfile || "";
  }, [profiles, user?.email, user?.id]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t("dashboardExtra.greetingMorning");
    if (hour < 18) return t("dashboardExtra.greetingDay");
    return t("dashboardExtra.greetingEvening");
  }, []);

  const timeEmoji = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "☀️";
    if (h < 18) return "👋";
    if (h < 22) return "🌙";
    return "🌟";
  }, []);

  const phraseOfDay = useMemo(() => {
    const start = new Date(new Date().getFullYear(), 0, 0).getTime();
    const day = Math.floor((Date.now() - start) / 86_400_000);
    return dayAffirmations[day % dayAffirmations.length];
  }, []);

  // Smart tasks list (manager-only)
  // Onboarding bonus tasks shown in "Що зробити далі" for independent tutors
  const TUTOR_BONUS_TASKS = [
    {
      action: "availability",
      emoji: "🕐",
      title: "Встанови доступні години",
      desc:  "Учні бронюватимуть слоти самостійно, без дзвінків",
      to:    "/profile#availability",
      done:  obProgress.hasAvailability,
    },
    {
      action: "zoom",
      emoji: "🎥",
      title: "Підключіть Zoom або Meet",
      desc:  "Постійне посилання — учень підключиться одним кліком",
      to:    "/profile#zoom",
      done:  obProgress.hasMeetingUrl,
    },
    {
      action: "calendar",
      emoji: "📆",
      title: "Підключіть Google Calendar",
      desc:  "Уроки автоматично з'являться у вашому Google Calendar",
      to:    "/profile#calendar",
      done:  obProgress.hasGoogleCalendar,
    },
    {
      action: "referral",
      emoji: "🎁",
      title: "Запросіть колегу",
      desc:  "1 місяць Pro за кожного друга, що оплатив підписку",
      to:    "/referrals",
      done:  obProgress.hasReferral,
    },
    {
      action: "ai",
      emoji: "✨",
      title: "AI-конспекти уроків",
      desc:  "Fireflies запише урок, AI зробить підсумок автоматично",
      to:    "/profile#ai",
      done:  false, // always suggest until skipped
    },
  ] as const;

  const pendingBonusTasks = TUTOR_BONUS_TASKS.filter(
    (t) => !t.done && !skippedTasks.includes(t.action)
      // Hub tutors get the same setup helpers (availability, Zoom, calendar, AI notes)
      // for parity — but NOT "referral" (Pro referrals are an independent-tutor concept).
      && !(isHubTutor && t.action === "referral")
  );

  const smartTasks = useMemo(() => {
    if (!isManager) return [] as Array<{
      key: string;
      icon: any;
      tone: "warning" | "destructive" | "primary";
      title: string;
      description: string;
      to: string;
      cta: string;
      payTutorId?: string;
    }>;
    const tasks: Array<any> = [];
    // 0. Дні виплат репетиторам (за графіком)
    payoutSchedules.forEach((sch) => {
      if (!isPayoutDueToday(sch)) return;
      const unpaid = lessons.filter(
        (l) => l.tutor_id === sch.user_id && l.tutor_payout_status === "unpaid" && l.status !== "cancelled",
      );
      const sum = unpaid.reduce((acc, l) => acc + (Number(l.tutor_payout) || 0), 0);
      tasks.push({
        key: `payout-${sch.user_id}`,
        icon: Wallet,
        tone: "warning" as const,
        title: `💰 Час виплати: ${sch.name}`,
        description: sum > 0 ? `${sum.toLocaleString(getLocale())} ₴ за ${unpaid.length} ${unpaid.length === 1 ? "урок" : unpaid.length < 5 ? "уроки" : "уроків"}` : "Усе виплачено 🎉",
        to: "/finances",
        cta: "Позначити виплаченим",
        payTutorId: sch.user_id,
      });
    });
    // 1. Pending payments — top priority for everyone, but smartTasks is manager-only here
    if (pendingPayments.length > 0) {
      tasks.push({
        key: "pending-payments",
        icon: TrendingUp,
        tone: "warning" as const,
        title: t("dashboardExtra.pendingPaymentsTitle", { count: pendingPayments.length }),
        description: t("dashboardExtra.pendingPaymentsDesc"),
        to: "/finances",
        cta: t("dashboardExtra.pendingPaymentsCta"),
      });
    }
    // 2. Tutor referral requests (students looking for a tutor)
    if (tutorReferralRequestCount > 0) {
      tasks.push({
        key: "tutor-referral-requests",
        icon: HandHeart,
        tone: "destructive" as const,
        title: `${tutorReferralRequestCount} запит${
          tutorReferralRequestCount === 1 ? "" : tutorReferralRequestCount < 5 ? "и" : "ів"
        } на репетитора`,
        description: t("dashboardExtra.tutorRequestsDesc"),
        to: "/referrals",
        cta: t("dashboardExtra.tutorRequestsCta"),
      });
    }
    // 3. Support / subscription requests
    if (supportRequestCount > 0) {
      tasks.push({
        key: "support-requests",
        icon: Crown,
        tone: "warning" as const,
        title: `${supportRequestCount} запит${
          supportRequestCount === 1 ? "" : supportRequestCount < 5 ? "и" : "ів"
        } на підписку`,
        description: t("dashboardExtra.supportRequestsDesc"),
        to: "/subscription-requests",
        cta: t("dashboardExtra.supportRequestsCta"),
      });
    }
    // Звернення користувачів (фідбек/баги/питання)
    if (feedbackNewCount > 0) {
      tasks.push({
        key: "feedback-inbox",
        icon: Inbox,
        tone: "primary" as const,
        title: `${feedbackNewCount} нов${feedbackNewCount === 1 ? "е звернення" : feedbackNewCount < 5 ? "і звернення" : "их звернень"}`,
        description: "Фідбек, баги та питання від користувачів.",
        to: "/feedback-inbox",
        cta: "Переглянути",
      });
    }
    // 4. Students without a tutor
    if (studentsWithoutTutor > 0) {
      tasks.push({
        key: "students-no-tutor",
        icon: UserX,
        tone: "destructive" as const,
        title: `${studentsWithoutTutor} учн${
          studentsWithoutTutor === 1 ? "ів" : studentsWithoutTutor < 5 ? "ів" : "ів"
        } без репетитора`,
        description: t("dashboardExtra.studentsWithoutTutorDesc"),
        to: "/people",
        cta: t("dashboardExtra.studentsWithoutTutorCta"),
      });
    }
    // 5. Lessons without meeting link
    if (lessonsWithoutMeeting > 0) {
      tasks.push({
        key: "no-meeting",
        icon: Video,
        tone: "primary" as const,
        title: t("dashboardPageExtra.lessonsWithoutLink", { count: lessonsWithoutMeeting }),
        description: t("dashboardExtra.noMeetingLinkDesc"),
        to: "/schedule?view=list&filter=nolink",
        cta: t("dashboardExtra.pendingLessonRequestsCta"),
      });
    }
    // Lower-priority items (kept for completeness)
    if (pendingLessonRequests > 0) {
      tasks.push({
        key: "pending-lessons",
        icon: AlertTriangle,
        tone: "warning" as const,
        title: `${pendingLessonRequests} запит${
          pendingLessonRequests === 1 ? "" : pendingLessonRequests < 5 ? "и" : "ів"
        } на уроки`,
        description: t("dashboardExtra.pendingLessonRequestsDesc"),
        to: "/schedule",
        cta: t("dashboardExtra.pendingLessonRequestsCta"),
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
        description: t("dashboardExtra.availabilityRequestsDesc"),
        to: "/availability",
        cta: t("dashboardExtra.availabilityRequestsCta"),
      });
    }
    if (lessonsWithoutPrice > 0) {
      tasks.push({
        key: "no-price",
        icon: Tag,
        tone: "warning" as const,
        title: t("dashboardPageExtra.lessonsWithoutPrice", { count: lessonsWithoutPrice }),
        description: t("dashboardExtra.noRateDesc"),
        to: "/schedule?view=list&filter=unpriced",
        cta: t("dashboardExtra.noRateCta"),
      });
    }
    return tasks;
  }, [
    isManager,
    payoutSchedules,
    lessons,
    pendingLessonRequests,
    pendingRequestCount,
    tutorReferralRequestCount,
    supportRequestCount,
    feedbackNewCount,
    studentsWithoutTutor,
    lessonsWithoutPrice,
    lessonsWithoutMeeting,
    pendingPayments.length,
  ]);

  return (
    <AppLayout>
      {/* Pull-to-refresh indicator — driven by pullProgress (0→1). Without this the
          pull gesture silently reloaded with no feedback and read as broken. */}
      {isPulling && (
        <div
          className="pointer-events-none fixed left-0 right-0 top-0 z-[60] flex justify-center"
          style={{ transform: `translateY(${Math.min(pullProgress, 1) * 10}px)` }}
        >
          <div
            className="mt-2 flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-semibold text-white shadow-lg"
            style={{ background: "#0f0f1a", opacity: Math.max(0.35, Math.min(pullProgress, 1)) }}
          >
            <RefreshCw
              className="h-4 w-4"
              style={{ color: "var(--teal)", transform: `rotate(${pullProgress * 270}deg)`, transition: "transform .08s linear" }}
            />
            {pullProgress >= 1 ? t("pullToRefresh.release") : t("pullToRefresh.pull")}
          </div>
        </div>
      )}
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {/* Hero: dark bg on mobile for readability, transparent on desktop */}
      <div className="-mx-4 -mt-4 mb-5 overflow-hidden rounded-b-[24px] lg:mx-0 lg:mt-0 lg:mb-6 lg:rounded-[18px]">
        <div
          className="relative px-5 py-6 lg:px-0 lg:py-0"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[26px] font-extrabold leading-tight text-foreground lg:text-[28px]">
                {timeEmoji}{" "}
                {greeting}{firstName ? <>{","}{" "}<span style={{ color: "var(--teal)" }}>{firstName}</span></> : "!"}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] text-muted-foreground">
                <Link
                  to="/schedule"
                  className="inline-flex items-center gap-1 transition-colors hover:text-white"
                >
                  <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--teal)" }} />
                  {t("dashboardExtra.lessonsToday", { count: todayLessons.length })}
                </Link>
                {pendingPayments.length > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                    <Clock className="h-3.5 w-3.5" />
                    {t("pendingPayments.title")}
                  </span>
                )}
              </p>
              <p className="mt-3 line-clamp-2 text-[16px] italic text-muted-foreground">
                ✨ {phraseOfDay}
              </p>
              {/* Trial countdown — між афірмацією і кнопками, читабельно */}
              {isIndependentTutor && isTrial && trialUntil && trialUntil.getTime() > Date.now() && (
                <Link
                  to="/subscription"
                  className="mt-3 inline-flex max-w-full items-center gap-2 self-start rounded-full px-4 py-1.5 text-[15px] font-semibold transition-opacity hover:opacity-80"
                  style={{
                    background: trialDaysLeft <= 3 ? "rgba(245,158,11,.15)" : "rgba(43,191,170,.12)",
                    color: trialDaysLeft <= 3 ? "#b45309" : "#25a896",
                    border: `1px solid ${trialDaysLeft <= 3 ? "rgba(245,158,11,.35)" : "rgba(43,191,170,.35)"}`,
                  }}
                >
                  <Sparkles className="h-4 w-4 shrink-0" style={{ color: trialDaysLeft <= 3 ? "#f59e0b" : "#2BBFAA" }} />
                  🎁 Пробний період: залишилось{" "}
                  <strong>{trialDaysLeft} {trialDaysLeft === 1 ? "день" : trialDaysLeft < 5 ? "дні" : "днів"}</strong>
                  <span className="hidden sm:inline">{" "}· Підключити за 249 ₴/міс →</span>
                  <span className="sm:hidden">{" "}→</span>
                </Link>
              )}
            </div>
            <div className="flex shrink-0 items-start gap-2 pt-0.5">
              {/* Golden bell — top right, standalone */}
              <NotificationBell className="hidden h-11 w-11 rounded-full lg:flex" />
              {/* Burger menu */}
              {isStudent && !isTutor && !isManager && (
                <FindTutorDialog
                  trigger={
                    <Button size="sm" className="h-11 rounded-xl text-[14px]" style={{ background: "var(--teal)" }}>
                      <HandHeart className="h-4 w-4" />
                    </Button>
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>



      <QuickLessonDialog
        open={quickLessonOpen}
        onOpenChange={setQuickLessonOpen}
        startsAt={quickLessonOpen ? new Date() : null}
        onCreated={loadData}
        onWantFullForm={() => { setQuickLessonOpen(false); navigate("/schedule"); }}
      />

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-6 sm:space-y-8 max-w-full overflow-x-clip">
          {/* Trial banner moved: mobile shows under Streak; desktop shows compact chip in hero header */}

          {/* ── Тріал закінчується — персональні цифри ── */}
          {showTrialBanner && (
            <div className="mb-4" style={{ position: "relative", borderRadius: 18, padding: "14px 44px 14px 16px",
              background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.45)" }}>
              <button onClick={() => { setTrialBannerHidden(true); if (trialBannerKey) localStorage.setItem(trialBannerKey, "1"); }}
                aria-label="Закрити" style={{ position: "absolute", top: 10, right: 10, width: 44, height: 44, borderRadius: 9,
                  border: "none", background: "rgba(154,106,18,.12)", color: "#9a6a12", cursor: "pointer" }}>✕</button>
              <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15.5, color: "#7a5a14" }}>
                ⏳ Пробний період закінчується через {trialDaysLeft} {trialDaysLeft === 1 ? "день" : trialDaysLeft < 5 ? "дні" : "днів"}
              </p>
              <p style={{ fontSize: 15, color: "#9a6a12", marginTop: 3, lineHeight: 1.45 }}>
                Цього місяця тут: <b>{trialStats.done}</b> проведених уроків і <b>{trialStats.earned.toLocaleString(getLocale())} ₴</b> зафіксовано. Оформи підписку — нічого не загубиться.
              </p>
              <button onClick={() => navigate("/subscription")}
                style={{ marginTop: 10, height: 40, padding: "0 16px", borderRadius: 11, border: "none", cursor: "pointer",
                  background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a",
                  fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15,
                  boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)" }}>
                Оформити підписку →
              </button>
            </div>
          )}

          {/* ── Закрити день — вечірній батч ── */}
          {closeDayRows.length > 0 && (
            <button onClick={() => setCloseDayOpen(true)}
              className="mb-4 w-full text-left"
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 18,
                background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", border: "none", cursor: "pointer",
                boxShadow: "0 14px 34px -18px rgba(15,15,26,.7)" }}>
              <span style={{ fontSize: 26 }}>🌙</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 16.5, color: "#fff" }}>
                  Закрити день
                </span>
                <span style={{ display: "block", fontSize: 14, color: "rgba(255,255,255,.65)", marginTop: 1 }}>
                  {closeDayRows.length} {closeDayRows.length === 1 ? "урок чекає" : closeDayRows.length < 5 ? "уроки чекають" : "уроків чекають"} відмітки «проведено + оплачено»
                </span>
              </span>
              <span style={{ flexShrink: 0, height: 38, padding: "0 14px", borderRadius: 11, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)" }}>
                Одним рухом
              </span>
            </button>
          )}

          {/* ── INDEPENDENT TUTOR: metric cards (mobile 2-col, desktop 3-col bento) ─── */}
          {isIndependentTutor && (
            <>
              {/* Mobile: Profit (2/3) + Students (1/3) */}
              <div className="grid grid-cols-3 gap-3 lg:hidden">
                <Link to="/finances" className="col-span-2 block overflow-hidden rounded-[18px] p-4 relative hover:shadow-sm transition-shadow"
                  style={{ background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)" }}>
                  <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "#6b7a99" }}>
                    💰 {t("dashboard.cardProfit") || "Твій дохід"}
                  </p>
                  <p className="mt-2 font-extrabold leading-none"
                    style={{ fontSize: 26, color: "var(--teal,#2BBFAA)", fontFamily: "Inter, system-ui", letterSpacing: "-0.02em" }}>
                    {formatPrice(profit, "UAH")}
                  </p>
                  {profitGrowthPct !== null && (
                    <p className="mt-1 text-[14px] font-bold"
                      style={{ color: profitGrowthPct >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                      {profitGrowthPct >= 0 ? "↑" : "↓"} {profitGrowthPct >= 0 ? "+" : ""}{profitGrowthPct}% {t("dashboard.vsLastMonth")}
                    </p>
                  )}
                  <div className="mt-2 relative" style={{ height: 14 }}>
                    <div className="absolute bottom-0 left-0 right-0 flex items-end gap-0.5" style={{ height: "100%" }}>
                      {monthlyProfitBars.map((h, i) => (
                        <div key={i} className="flex-1 rounded-sm"
                          style={{ height: `max(${h}%, 3px)`, background: i === 5 ? "#2BBFAA" : "rgba(43,191,170,0.2)" }} />
                      ))}
                    </div>
                  </div>
                </Link>
                <Link to="/my-students" className="flex flex-col justify-center rounded-[18px] border bg-white p-3 hover:shadow-sm transition-shadow"
                  style={{ borderColor: "var(--border,#eceef3)" }}>
                  <div className="w-8 h-8 rounded-[10px] flex items-center justify-center mb-2"
                    style={{ background: "rgba(43,191,170,0.1)" }}>
                    <GraduationCap className="h-4 w-4" style={{ color: "#2BBFAA" }} />
                  </div>
                  <p className="font-extrabold leading-none"
                    style={{ fontSize: 28, fontFamily: "Inter, system-ui", color: "var(--txt,#0f0f1a)", letterSpacing: "-0.02em" }}>
                    {myStudentCount ?? 0}
                  </p>
                  <p className="mt-1 text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                    {t("dashboard.cardStudents") || "учні"} · активних
                  </p>
                </Link>
              </div>

              {/* Desktop bento: 4 compact cards — height ~56px */}
              <div className="hidden lg:grid lg:grid-cols-4 lg:gap-3">
                {/* 1. Profit */}
                <Link to="/finances" className="overflow-hidden rounded-[14px] px-3 py-2 flex items-center gap-3 hover:shadow-sm transition-shadow"
                  style={{ background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", minHeight: 56 }}>
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold uppercase tracking-wider" style={{ color: "#8a96b3" }}>
                      💰 Дохід
                    </p>
                    <p className="font-black leading-none mt-0.5"
                      style={{ fontSize: 30, color: "#2BBFAA", fontFamily: "Inter, system-ui", letterSpacing: "-0.02em" }}>
                      {formatPrice(profit, "UAH")}
                    </p>
                    {profitGrowthPct !== null && (
                      <p className="text-[14px] font-bold mt-0.5"
                        style={{ color: profitGrowthPct >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                        {profitGrowthPct >= 0 ? "↑ +" : "↓ "}{profitGrowthPct}%
                      </p>
                    )}
                  </div>
                </Link>

                {/* 2. Students */}
                <Link to="/my-students" className="rounded-[14px] border bg-white px-3 py-2 flex items-center gap-2.5 hover:shadow-sm transition-shadow"
                  style={{ borderColor: "var(--border,#eceef3)", minHeight: 56 }}>
                  <div className="w-7 h-7 rounded-[8px] flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(43,191,170,0.1)" }}>
                    <GraduationCap className="h-3.5 w-3.5" style={{ color: "#2BBFAA" }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold uppercase tracking-wider" style={{ color: "var(--sub,#6b7088)" }}>
                      Учні
                    </p>
                    <p className="font-black leading-none mt-0.5"
                      style={{ fontSize: 30, fontFamily: "Inter, system-ui", color: "var(--txt,#0f0f1a)", letterSpacing: "-0.02em" }}>
                      {myStudentCount ?? 0}
                    </p>
                  </div>
                </Link>

                {/* 3. Level */}
                {level ? (
                  <Link to="/achievements" aria-label={t("nav.achievements")}
                    className="rounded-[14px] border bg-white px-3 py-2 flex items-center gap-2.5 transition-shadow hover:shadow-md"
                    style={{ borderColor: "var(--border,#eceef3)", minHeight: 56 }}>
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold uppercase tracking-wider" style={{ color: "var(--sub,#6b7088)" }}>
                        🏅 Рівень
                      </p>
                      <p className="font-black text-[18px] leading-tight mt-0.5" style={{ fontFamily: "Inter, system-ui" }}>
                        {level.emoji} {level.name}
                      </p>
                    </div>
                  </Link>
                ) : (
                  <div className="rounded-[14px] border bg-white" style={{ borderColor: "var(--border,#eceef3)", minHeight: 56 }} />
                )}

                {/* 4. Streak */}
                {streak ? (
                  <Link to="/achievements" aria-label={t("nav.achievements")}
                    className="rounded-[14px] border bg-white px-3 py-2 flex items-center gap-2.5 transition-shadow hover:shadow-md"
                    style={{ borderColor: "var(--border,#eceef3)", minHeight: 56,
                             background: streak.current_streak > 0 ? "linear-gradient(135deg,#fff8f0,#fff)" : "#fff" }}>
                    <span className="text-xl flex-shrink-0">🔥</span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold uppercase tracking-wider" style={{ color: "var(--sub,#6b7088)" }}>
                        Серія
                      </p>
                      <p className="font-black text-[18px] leading-tight mt-0.5" style={{ fontFamily: "Inter, system-ui" }}>
                        {streak.current_streak} {streak.current_streak === 1 ? "день" : streak.current_streak < 5 ? "дні" : "днів"}
                      </p>
                    </div>
                  </Link>
                ) : (
                  <div className="rounded-[14px] border bg-white" style={{ borderColor: "var(--border,#eceef3)", minHeight: 56 }} />
                )}
              </div>

            </>
          )}

          {/* ── INDEPENDENT TUTOR: Notes always above lessons ── */}
          {isIndependentTutor && (
            <div>
              <TutorNotesCard />
            </div>
          )}


          {/* ── MANAGER: Profit dark card + 3 stat cards ─────────────── */}
          {isManager && (
            <>
              {/* Mobile/tablet: Profit (2/3) + Students (1/3); then Tutors + Lessons.
                  Desktop (lg) uses the 4-col grid below. Profit taps → Finances. */}
              <div className="grid grid-cols-3 gap-3 lg:hidden">
                <Link
                  to="/finances"
                  className="col-span-2 block overflow-hidden rounded-[18px] p-4 sm:p-5 hover:shadow-sm transition-shadow"
                  style={{ background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 100%)" }}
                >
                  <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "#6b7a99" }}>
                    💰 {t("dashboard.cardProfit")}
                  </p>
                  <p className="mt-2 text-[30px] font-extrabold leading-none" style={{ color: "var(--teal)" }}>
                    {formatPrice(profit, "UAH")}
                  </p>
                  {profitGrowthPct !== null && (
                    <p className="mt-1 text-[14px] font-medium" style={{ color: profitGrowthPct >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                      {profitGrowthPct >= 0 ? "↑" : "↓"} {profitGrowthPct >= 0 ? "+" : ""}{profitGrowthPct}% {t("dashboard.vsLastMonth")}
                    </p>
                  )}
                  <div className="mt-3 flex items-end gap-1" style={{ height: "20px" }}>
                    {monthlyProfitBars.map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm" style={{ height: `max(${h}%, 3px)`, background: i === 5 ? "var(--teal)" : "rgba(43,191,170,0.2)" }} />
                    ))}
                  </div>
                </Link>
                <Link to="/people" className="col-span-1 flex flex-col justify-center rounded-[18px] border bg-white p-3 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#eceef3)" }}>
                  <div className="w-8 h-8 rounded-[10px] flex items-center justify-center mb-2" style={{ background: "rgba(43,191,170,0.1)" }}>
                    <GraduationCap className="h-4 w-4" style={{ color: "#2BBFAA" }} />
                  </div>
                  <p className="font-extrabold leading-none" style={{ fontSize: 28, fontFamily: "Inter, system-ui", color: "var(--txt,#0f0f1a)", letterSpacing: "-0.02em" }}>{myStudentCount ?? 0}</p>
                  <p className="mt-1 text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.cardStudents")}</p>
                </Link>
              </div>
              {/* Tutors + Lessons today — mobile/tablet (lg uses the 4-col grid below) */}
              <div className="grid grid-cols-2 gap-3 lg:hidden">
                <Link to="/people" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#eceef3)" }}>
                  <div>
                    <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.cardTutors")}</p>
                    <p className="mt-1 text-[26px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{tutorCount}</p>
                    <p className="mt-0.5 text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.cardTutorsSub") || "активних"}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
                <Link to="/schedule" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#eceef3)" }}>
                  <div>
                    <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.todayLessons")}</p>
                    <p className="mt-1 text-[26px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{todayLessons.length}</p>
                    <p className="mt-0.5 text-[14px]" style={{ color: todayLessons.length === 0 ? "var(--muted)" : "var(--teal)" }}>{todayLessons.length === 0 ? (t("dashboard.todayFree") || "вільний день") : t("dashboard.lessonsToday")}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
              </div>
              {/* Desktop lg: all 4 in one row */}
              <div className="hidden lg:grid lg:grid-cols-4 lg:gap-3">
                <Link
                  to="/finances"
                  className="block overflow-hidden rounded-[16px] p-4 hover:shadow-sm transition-shadow"
                  style={{ background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 100%)" }}
                >
                  <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "#6b7a99" }}>💰 {t("dashboard.cardProfit")}</p>
                  <p className="mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: "var(--teal)" }}>{formatPrice(profit, "UAH")}</p>
                  <p className="mt-0.5 text-[14px] font-medium" style={{ color: "#6b7a99" }}>{profitPeriodLabel[profitPeriod]}</p>
                  <div className="mt-2 flex items-end gap-0.5" style={{ height: "16px" }}>
                    {monthlyProfitBars.map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm"
                        style={{ height: `max(${h}%, 3px)`, background: i === 5 ? "var(--teal)" : "rgba(43,191,170,0.2)" }} />
                    ))}
                  </div>
                </Link>
                <Link to="/people" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#eceef3)" }}>
                  <div>
                    <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.cardTutors")}</p>
                    <p className="mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{tutorCount}</p>
                    <p className="mt-0.5 text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.cardTutorsSub")}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
                <Link to="/people" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#eceef3)" }}>
                  <div>
                    <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.cardStudents")}</p>
                    <p className="mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{myStudentCount ?? 0}</p>
                    <p className="mt-0.5 text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.cardStudentsSub")}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
                <Link to="/schedule" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#eceef3)" }}>
                  <div>
                    <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#6b7088)" }}>{t("dashboard.todayLessons")}</p>
                    <p className="mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{todayLessons.length}</p>
                    <p className="mt-0.5 text-[14px]" style={{ color: todayLessons.length===0?"var(--muted)":"var(--teal)" }}>{todayLessons.length===0?t("dashboard.todayFree"):t("dashboard.lessonsToday")}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
              </div>
            </>
          )}

          {/* Notes — ALWAYS directly under the bubbles, nowhere else (manager). */}
          {isManager && (
            <div className="mt-4">
              <TutorNotesCard />
            </div>
          )}

          {/* Top-10% badge */}
          {isTutor && !isManager && topPercentile !== null && topPercentile < 10 && (
            <TopTutorBadge percentile={topPercentile} />
          )}
          {isIndependentTutor && user && localStorage.getItem(`pending_invite_reminder_${user.id}`) === "1" && (
            <div className="flex items-start justify-between gap-3 rounded-[16px] border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/15 text-primary">
                  <HandHeart className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Ви ще не запросили учня</p>
                  <p className="mt-0.5 text-[14px] text-muted-foreground">
                    Запросіть першого учня — це займе хвилину, а ваш простір одразу оживе.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => setAddStudentOpen(true)}>
                      Запросити зараз
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 shrink-0"
                aria-label="Прибрати нагадування"
                onClick={() => {
                  localStorage.removeItem(`pending_invite_reminder_${user.id}`);
                  // Force re-render via state bump
                  setAddStudentOpen((v) => v);
                  loadData();
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {isHubTutor && (
            <div className="mt-4 space-y-4">
              {/* Violet hub chip — «Хаб «{hubName}»». No hub-name source in DB yet,
                  so falls back to «Хаб» (see followups). */}
              <div className="flex">
                <span
                  className="inline-flex h-[30px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-bold"
                  style={{
                    background: "rgba(124,58,237,.12)",
                    color: "#7c3aed",
                    boxShadow: "inset 0 0 0 1px rgba(124,58,237,.28)",
                  }}
                >
                  <GraduationCap className="h-[15px] w-[15px]" />
                  {t("hubTutor.hubChip", { name: t("hubTutor.hubFallbackName") })}
                </span>
              </div>

              {/* #1 hub-tutor job — mark conducted lessons done — surfaced at the
                  TOP of the hub block, above the payout figure (which is only
                  checked occasionally). Renders nothing when there's nothing to mark. */}
              {user && (
                <NeedsMarkingCard
                  lessons={lessons.filter((l) => l.status === "scheduled" && l.tutor_id === user.id)}
                  studentNames={profiles}
                  onChanged={loadData}
                />
              )}

              {/* Mobile/tablet bubbles (lg uses the manager-style compact row
                  below): payout full-width, then the two stat tiles in a row. */}
              <div className="grid grid-cols-2 gap-3 lg:hidden">
              {/* «До виплати від хабу» — dark gradient card. Money = own
                  tutor_payout + own rate ONLY. Never student_price / hub margin.
                  Tap → Finances (the money bubble is clickable for every role). */}
              <Link
                to="/finances"
                className="col-span-2 block overflow-hidden rounded-[16px] p-[18px] text-white hover:shadow-sm transition-shadow"
                style={{
                  background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 100%)",
                  boxShadow: "0 14px 34px -18px rgba(15,15,26,.7)",
                }}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <span
                    className="text-[14px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: "rgba(255,255,255,.6)" }}
                  >
                    💼 {t("hubTutor.payoutDueTitle")}
                  </span>
                  <span
                    className="inline-flex h-[30px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-bold"
                    style={{ background: "rgba(255,255,255,.16)", color: "#fff" }}
                  >
                    <GraduationCap className="h-[15px] w-[15px]" />
                    {t("hubTutor.hubChip", { name: t("hubTutor.hubFallbackName") })}
                  </span>
                </div>
                <p
                  className="mt-3 text-[40px] font-extrabold leading-none"
                  style={{ color: "var(--teal)", letterSpacing: "-0.02em" }}
                >
                  {formatPrice(hubPayoutDue, "UAH")}
                </p>
                {hubPayoutDue > 0 ? (
                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {hubNextPayout && (
                      <span
                        className="inline-flex h-[32px] items-center gap-1.5 rounded-full px-3 text-[14px] font-bold"
                        style={{ background: "rgba(255,255,255,.1)" }}
                      >
                        <CalendarDays className="h-4 w-4" />
                        {hubNextPayout.toLocaleDateString(getLocale(), { day: "numeric", month: "long" })}
                      </span>
                    )}
                    <span
                      className="inline-flex h-[32px] items-center rounded-full px-3 text-[14px] font-bold"
                      style={{ background: "rgba(255,255,255,.1)" }}
                    >
                      {t("hubTutor.payoutLessonsChip", { count: hubPayoutLessonsCount })}
                    </span>
                  </div>
                ) : (
                  <p className="mt-2.5 text-[15px]" style={{ color: "rgba(255,255,255,.66)" }}>
                    {hubNextPayout
                      ? t("hubTutor.payoutOn", {
                          date: hubNextPayout.toLocaleDateString(getLocale(), { day: "numeric", month: "long" }),
                        })
                      : t("hubTutor.payoutEmptyHint")}
                  </p>
                )}
                {hubRate != null && hubRate > 0 && (
                  <div
                    className="mt-4 flex items-center justify-between border-t pt-3.5"
                    style={{ borderColor: "rgba(255,255,255,.12)" }}
                  >
                    <span className="text-[15px]" style={{ color: "rgba(255,255,255,.6)" }}>
                      {t("hubTutor.rateFooterLabel")}
                    </span>
                    <span className="text-[18px] font-extrabold" style={{ color: "#4ade80" }}>
                      {formatPrice(hubRate, "UAH")}
                    </span>
                  </div>
                )}
              </Link>

              {/* Two stat tiles: hub students + lessons today — direct children of
                  the bento grid above (stacked on the right of the payout hero on
                  desktop; a 2-col row under it on mobile). */}
                <div
                  className="flex flex-col justify-center rounded-[18px] border bg-white p-[18px]"
                  style={{ borderColor: "var(--border,#eceef3)" }}
                >
                  <div
                    className="mb-3 flex h-10 w-10 items-center justify-center rounded-[12px]"
                    style={{ background: "rgba(124,58,237,.1)" }}
                  >
                    <GraduationCap className="h-5 w-5" style={{ color: "#7c3aed" }} />
                  </div>
                  <p
                    className="text-[30px] font-extrabold leading-none"
                    style={{ color: "var(--txt,#0f0f1a)", letterSpacing: "-0.02em" }}
                  >
                    {hubStudentCount ?? 0}
                  </p>
                  <p className="mt-1.5 text-[15px]" style={{ color: "var(--sub,#9398b0)" }}>
                    {t("hubTutor.hubStudents")}
                  </p>
                </div>
                <div
                  className="flex flex-col justify-center rounded-[18px] border bg-white p-[18px]"
                  style={{ borderColor: "var(--border,#eceef3)" }}
                >
                  <div
                    className="mb-3 flex h-10 w-10 items-center justify-center rounded-[12px]"
                    style={{ background: "rgba(43,191,170,.1)" }}
                  >
                    <CalendarDays className="h-5 w-5" style={{ color: "var(--teal)" }} />
                  </div>
                  <p
                    className="text-[30px] font-extrabold leading-none"
                    style={{ color: "var(--txt,#0f0f1a)", letterSpacing: "-0.02em" }}
                  >
                    {hubLessonsTodayCount}
                  </p>
                  <p className="mt-1.5 text-[15px]" style={{ color: "var(--sub,#9398b0)" }}>
                    {t("hubTutor.lessonsToday")}
                  </p>
                </div>
              </div>

              {/* Desktop lg: payout (dark) + students + lessons today in ONE row —
                  same compact card style as the manager dashboard so the hub-tutor
                  cabinet looks as filled/polished on a wide screen. */}
              <div className="hidden lg:grid lg:grid-cols-3 lg:gap-3">
                {/* Payout (dark) — own tutor_payout + own rate ONLY. → Finances. */}
                <Link
                  to="/finances"
                  className="block overflow-hidden rounded-[16px] p-4 hover:shadow-sm transition-shadow"
                  style={{ background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 100%)" }}
                >
                  <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "#6b7a99" }}>
                    💼 {t("hubTutor.payoutDueTitle")}
                  </p>
                  <p className="mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: "var(--teal)" }}>
                    {formatPrice(hubPayoutDue, "UAH")}
                  </p>
                  <p className="mt-0.5 text-[14px] font-medium" style={{ color: "#6b7a99" }}>
                    {hubNextPayout
                      ? t("hubTutor.payoutOn", {
                          date: hubNextPayout.toLocaleDateString(getLocale(), { day: "numeric", month: "long" }),
                        })
                      : profitPeriodLabel[profitPeriod]}
                  </p>
                  {hubRate != null && hubRate > 0 && (
                    <p className="mt-2 text-[14px] font-semibold" style={{ color: "#4ade80" }}>
                      {t("hubTutor.rateFooterLabel")}: {formatPrice(hubRate, "UAH")}
                    </p>
                  )}
                </Link>
                {/* Hub students (no dedicated page for hub tutor → plain card, no chevron) */}
                <div
                  className="flex items-center justify-between rounded-[16px] border bg-white p-4"
                  style={{ borderColor: "var(--border,#eceef3)" }}
                >
                  <div>
                    <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#6b7088)" }}>
                      {t("hubTutor.hubStudents")}
                    </p>
                    <p className="mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>
                      {hubStudentCount ?? 0}
                    </p>
                    <p className="mt-0.5 text-[14px]" style={{ color: "var(--sub,#6b7088)" }}>
                      {t("dashboard.cardStudentsSub")}
                    </p>
                  </div>
                  <GraduationCap className="h-5 w-5" style={{ color: "#7c3aed" }} />
                </div>
                {/* Lessons today → Schedule (chevron) */}
                <Link
                  to="/schedule"
                  className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow"
                  style={{ borderColor: "var(--border,#eceef3)" }}
                >
                  <div>
                    <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#6b7088)" }}>
                      {t("dashboard.todayLessons")}
                    </p>
                    <p className="mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>
                      {hubLessonsTodayCount}
                    </p>
                    <p
                      className="mt-0.5 text-[14px]"
                      style={{ color: hubLessonsTodayCount === 0 ? "var(--muted)" : "var(--teal)" }}
                    >
                      {hubLessonsTodayCount === 0 ? t("dashboard.todayFree") : t("dashboard.lessonsToday")}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
              </div>

              {/* Notes — ALWAYS directly under the bubbles, nowhere else (hub tutor:
                  the payout card + these two stat tiles ARE the hub "bubbles"). */}
              <TutorNotesCard />

              {/* «Pro активний — від хабу» — replaces any upsell for hub tutors. */}
              <div
                className="flex items-center gap-3 rounded-[16px] p-[14px]"
                style={{
                  background: "rgba(124,58,237,.07)",
                  border: "1px solid rgba(124,58,237,.25)",
                }}
              >
                <div
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px]"
                  style={{ background: "rgba(124,58,237,.14)", color: "#7c3aed" }}
                >
                  <Crown className="h-[22px] w-[22px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-extrabold" style={{ color: "var(--txt,#0f0f1a)" }}>
                    {t("hubTutor.proActiveTitle")}
                  </p>
                  <p className="text-[14px]" style={{ color: "var(--sub,#9398b0)" }}>
                    {t("hubTutor.proActiveDesc")}
                  </p>
                </div>
              </div>

              {/* NO PendingPaymentsCard for hub tutors: it reads student_price and lets
                  the viewer mark/remind student→HUB debt — money the hub is owed, not
                  the tutor. The hub tutor's own due is the «До виплати від хабу» card
                  above (hubPayoutDue). Showing student receivables here leaked the hub's
                  revenue to the tutor. Manager/independent usages are untouched. */}
              {/* «Написати менеджеру» — one of the two things a hub tutor opens the
                  app to do, so it's a prominent teal action, not a quiet gray outline. */}
              <button
                type="button"
                disabled={openingManagerChat}
                onClick={openManagerChat}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[13px] text-[15px] font-bold transition-opacity active:opacity-80 disabled:opacity-70"
                style={{ background: "rgba(43,191,170,.12)", color: "#1f8e7e", boxShadow: "inset 0 0 0 1px rgba(43,191,170,.32)" }}
              >
                {openingManagerChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                {t("dashboard.hubManager")}
              </button>
            </div>
          )}

          {isStudent && !isTutor && !isManager && user && (
            <div className="mt-4">
              <StudentWalletCard studentId={user.id} />
            </div>
          )}

          {/* "До уваги" — past scheduled lessons not yet marked. Manager: across all
              tutors; independent tutor: own. Hub tutors get this at the TOP of their
              hub block instead (see above), so they're excluded here to avoid a
              duplicate marking card. */}
          {(isManager || isIndependentTutor) && user && (
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

          {/* (Removed the second "needs marking" LessonCard section — it duplicated
              NeedsMarkingCard above for manager/independent/hub tutors and, being
              un-role-gated, wrongly rendered a mark-done surface for students too.) */}

          {/* ── MANAGER: Pending payments list ─────────────────────────────── */}
          {isManager && (
            <div className="mt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub, #6b7088)" }}>
                  💰 {t("pendingPayments.title")}
                </p>
                {pendingPayments.length > 0 && (
                  <span className="text-[14px] font-semibold" style={{ color: "#f59e0b" }}>
                    {pendingPayments.length} {pendingPayments.length === 1 ? t("lessonCard.lesson") : t("lessonCard.lessons")}
                  </span>
                )}
              </div>

              {pendingPayments.length === 0 ? (
                /* Empty state — all paid */
                <div
                  className="flex flex-col items-center gap-3 rounded-[16px] bg-white px-5 py-7 text-center"
                  style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
                >
                  <span className="text-3xl">☀️</span>
                  <div>
                    <p className="text-[15px] font-semibold" style={{ color: "var(--txt, #0f0f1a)" }}>
                      {t("dashboard.allPaidTitle") || "Так тримати!"}
                    </p>
                    <p className="mt-1 text-[14px]" style={{ color: "var(--sub, #6b7088)" }}>
                      {t("dashboard.allPaidDesc") || "Усі уроки оплачені — все під контролем 🎉"}
                    </p>
                  </div>
                </div>
              ) : (
                /* Lesson cards — same style as schedule list */
                <div className="space-y-2.5">
                  {[
                    ...pendingPayments.slice(0, 5),
                    ...Object.values(exitingPay).filter((l: any) => !pendingPayments.some((p) => p.id === l.id)),
                  ].map((lesson: any) => {
                    const tutorName = profiles[lesson.tutor_id] ?? "—";
                    const studentName = lesson.student_id ? (profiles[lesson.student_id] ?? "—") : t("groupLessons.cardLabel");
                    const meetingHref = effectiveMeetingUrl(lesson);
                    const isExiting = !!exitingPay[lesson.id];
                    return (
                      <div
                        key={lesson.id}
                        className="transition-all duration-500 ease-out"
                        style={isExiting ? { opacity: 0, transform: "translateX(32px) scale(0.97)" } : undefined}
                      >
                        <LessonCard
                          lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                          role={isManager ? "manager" : "tutor"}
                          studentName={studentName}
                          tutorName={tutorName}
                          showTutor
                          meetingUrl={meetingHref}
                          chatPartnerId={user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id}
                          onContentClick={() => setOpenLessonId(lesson.id)}
                          className={lessonSourceTint(lesson.source)}
                          canEditStatus
                          statusOptions={["scheduled","completed","cancelled"] as LessonStatus[]}
                          onStatusChange={(s) => updateStatus(lesson.id, s)}
                          onPayChange={(field, paid) =>
                            field === "student" && paid
                              ? markPendingPaid(lesson)
                              : updatePayment(
                                  lesson.id,
                                  field === "student" ? "student_payment_status" : "tutor_payout_status",
                                  (paid ? "paid" : "unpaid") as PaymentStatus,
                                )
                          }
                        />
                      </div>
                    );
                  })}
                  {pendingPayments.length > 5 && (
                    <button
                      className="w-full rounded-[14px] py-2.5 text-[14px] font-medium transition-colors"
                      style={{ background: "var(--teal-l, #f0fdf9)", color: "var(--teal, #2BBFAA)" }}
                      onClick={() => window.location.href = "/finances"}
                    >
                      {t("dashboard.showAll", { count: pendingPayments.length })} →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2 md:gap-6">
            <section className="order-1 min-w-0">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub, var(--ds-sub))" }}>
                  {isIndependentTutor
                    ? `🗓️ ${"Сьогодні"} · ${todayLessons.length} ${"урок".slice(0, todayLessons.length === 1 ? 5 : todayLessons.length < 5 ? 5 : 6)}`
                    : t("dashboard.upcomingLessons")}
                </p>
                <button
                  className="text-[14px] font-semibold transition-colors hover:underline"
                  style={{ color: "var(--teal)" }}
                  onClick={() => navigate("/schedule")}
                >
                  {t("nav.schedule") || "Розклад"} →
                </button>
              </div>
              <div className={`space-y-2.5 ${showAllUpcoming ? "max-h-[60vh] overflow-y-auto pr-1" : ""}`}>
                {upcomingLessons.length === 0 ? (
                  <div
                    className="flex flex-col items-center gap-3 rounded-[16px] bg-white px-5 py-7 text-center shadow-[0_1px_4px_rgba(0,0,0,0.05)]"
                  >
                    <span className="text-3xl">☀️</span>
                    <div>
                      {isIndependentTutor && (myStudentCount ?? 0) === 0 ? (
                        <>
                          <p className="text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>{t("dashboardPageExtra.addFirstStudent")}</p>
                          <p className="mt-0.5 text-[14px]" style={{ color: "var(--ds-sub)" }}>{t("dashboardPageExtra.addFirstStudentHint")}</p>
                          <Button
                            size="sm"
                            className="mt-3 rounded-xl"
                            style={{ background: "var(--teal-l)", color: "var(--teal)", border: "1px solid rgba(43,191,170,0.3)" }}
                            onClick={() => setAddStudentOpen(true)}
                          >
                            <Plus className="h-4 w-4" />
                            {t("onboardingContent.addStudentCta")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>
                            {t("dashboard.noUpcoming")}
                          </p>
                          <p className="mt-0.5 text-[14px]" style={{ color: "var(--ds-sub)" }}>Сьогодні вільний день</p>
                          {isTutor && !isManager && (
                            <Button
                              size="sm"
                              className="mt-3 rounded-xl"
                              style={{ background: "var(--teal-l)", color: "var(--teal)", border: "1px solid rgba(43,191,170,0.3)" }}
                              onClick={() => setQuickLessonOpen(true)}
                            >
                              <Plus className="h-4 w-4" />
                              {t("dashboard.btnCreateLesson")}
                            </Button>
                          )}
                          {isStudent && !isTutor && !isManager && (
                            <div className="mt-3">
                              <FindTutorDialog
                                trigger={
                                  <Button size="sm" className="rounded-xl" style={{ background: "var(--teal-l)", color: "var(--teal)", border: "1px solid rgba(43,191,170,0.3)" }}>
                                    {t("dashboard.btnRequestTutor")}
                                  </Button>
                                }
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  upcomingLessons.map((lesson) => {
                    const isParticipant = user?.id === lesson.tutor_id || user?.id === lesson.student_id;
                    const meetingHref = effectiveMeetingUrl(lesson);
                    const tutorName = profiles[lesson.tutor_id] ?? "—";
                    const studentName = lesson.student_id ? (profiles[lesson.student_id] ?? "—") : t("groupLessons.cardLabel");

                    if (isManager && !isParticipant) {
                      const canEditStatus = true;
                      return (
                        <LessonCard
                          key={lesson.id}
                          lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                          role={isManager ? "manager" : "tutor"}
                          studentName={studentName}
                          tutorName={tutorName}
                          showTutor
                          meetingUrl={meetingHref}
                          chatPartnerId={user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id}
                          onContentClick={() => setOpenLessonId(lesson.id)}
                          className={lessonSourceTint(lesson.source)}
                          canEditStatus={canEditStatus}
                          statusOptions={["pending","scheduled","completed","cancelled"] as LessonStatus[]}
                          onStatusChange={canEditStatus ? (s) => updateStatus(lesson.id, s) : undefined}
                          onPayChange={(field, paid) => updatePayment(lesson.id, field === "student" ? "student_payment_status" : "tutor_payout_status", (paid ? "paid" : "unpaid") as PaymentStatus)}
                          onWallet={() => setWalletPair({ tutor_id: lesson.tutor_id, student_id: lesson.student_id, tutor_name: tutorName, student_name: studentName })}
                        />
                      );
                    }

                    const canEditStatus = isManager || (isTutor && lesson.tutor_id === user?.id);

                    return (
                      <LessonCard
                        key={lesson.id}
                        lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                        role={isManager ? "manager" : "tutor"}
                        studentName={studentName}
                        tutorName={tutorName}
                        showTutor={isManager}
                        showPayout={isManager || lesson.source === "hub"}
                        chatPartnerId={user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id}
                        onContentClick={() => setOpenLessonId(lesson.id)}
                        canEditStatus={canEditStatus}
                        statusOptions={(isManager ? ["pending","scheduled","completed","cancelled"] : ["scheduled","completed","cancelled"]) as LessonStatus[]}
                        onStatusChange={canEditStatus ? (s) => updateStatus(lesson.id, s) : undefined}
                        onPayChange={(field, paid) => updatePayment(lesson.id, field === "student" ? "student_payment_status" : "tutor_payout_status", (paid ? "paid" : "unpaid") as PaymentStatus)}
                      />
                    );
                  })
                )}
              </div>
            </section>

            <section className="order-2 min-w-0">
              <p className="mb-3 text-[14px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub, var(--ds-sub))" }}>
                {t("dashboard.nextSteps")}
              </p>

              {isManager ? (
                <div className="space-y-2.5">
                  {smartTasks.length === 0 ? (
                    <div
                      className="rounded-[16px] bg-white px-5 py-5 text-center shadow-[0_1px_4px_rgba(0,0,0,0.05)]"
                    >
                      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "rgba(43,191,170,0.12)" }}>
                        <TrendingUp className="h-4 w-4" style={{ color: "var(--teal)" }} />
                      </div>
                      <p className="text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>{t("emptyState.allClear")}</p>
                      <p className="mt-1 text-[14px]" style={{ color: "var(--ds-sub)" }}>
                        {t("dashboardPageExtra.allClearDesc")}
                      </p>
                    </div>
                  ) : (
                    smartTasks.map((task) => {
                      const Icon = task.icon;
                      const borderColor =
                        task.tone === "destructive" ? "#3b82f6"
                        : task.tone === "warning"    ? "#f59e0b"
                        : "#d0d3e0";
                      const iconBg =
                        task.tone === "destructive" ? "rgba(59,130,246,0.12)"
                        : task.tone === "warning"    ? "rgba(245,158,11,0.12)"
                        : "rgba(208,211,224,0.25)";
                      const iconColor =
                        task.tone === "destructive" ? "#3b82f6"
                        : task.tone === "warning"    ? "#f59e0b"
                        : "#9398b0";
                      return (
                        task.payTutorId ? (
                          <div key={task.key}
                            className="ds-pop-in flex items-center gap-3 overflow-hidden rounded-[16px] bg-white py-3.5 pl-4 pr-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                            style={{ borderLeft: `3.5px solid ${borderColor}` }}>
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: iconBg }}>
                              <Icon className="h-4 w-4" style={{ color: iconColor }} />
                            </div>
                            <Link to={task.to} className="min-w-0 flex-1">
                              <p className="text-[14px] font-semibold leading-tight" style={{ color: "var(--ds-txt)" }}>{task.title}</p>
                              <p className="mt-0.5 text-[14px] leading-snug" style={{ color: "var(--ds-sub)" }}>{task.description}</p>
                            </Link>
                            <button type="button" disabled={payingTutor === task.payTutorId}
                              onClick={() => markPayoutPaid(task.payTutorId!)}
                              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] px-3 text-[14px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                              style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", fontFamily: "Inter, system-ui, sans-serif", boxShadow: "0 6px 16px -8px rgba(43,191,170,.6)" }}>
                              {payingTutor === task.payTutorId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              Виплачено
                            </button>
                          </div>
                        ) : (
                        <Link key={task.key} to={task.to} className="block group">
                          <div
                            className="ds-pop-in flex items-center gap-3 overflow-hidden rounded-[16px] bg-white py-3.5 pl-4 pr-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all duration-200 active:scale-[0.98] group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.09)]"
                            style={{ borderLeft: `3.5px solid ${borderColor}` }}
                          >
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                              style={{ background: iconBg }}
                            >
                              <Icon className="h-4 w-4" style={{ color: iconColor }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-semibold leading-tight" style={{ color: "var(--ds-txt)" }}>
                                {task.title}
                              </p>
                              <p className="mt-0.5 text-[14px] leading-snug" style={{ color: "var(--ds-sub)" }}>
                                {task.description}
                              </p>
                            </div>
                            <ChevronRight className="ml-1 h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5" />
                          </div>
                        </Link>
                        )
                      );
                    })
                  )}
                  <TelegramLinkCard />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {isStudent && (
                    <>
                      {studentTutorCount > 0 ? (
                        <Link to="/schedule" className="block group">
                          <div className="ds-pop-in flex items-center gap-3 overflow-hidden rounded-[18px] bg-white py-3.5 pl-4 pr-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all active:scale-[0.98] group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.09)]" style={{ borderLeft: "3.5px solid #2BBFAA" }}>
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(43,191,170,0.12)" }}>
                              <CalendarDays className="h-4 w-4" style={{ color: "var(--teal)" }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-semibold leading-tight" style={{ color: "var(--ds-txt)" }}>{t("dashboardPageExtra.tutorAssignsLessons")}</p>
                              <p className="mt-0.5 text-[14px]" style={{ color: "var(--ds-sub)" }}>{t("studentPages.tutorScheduleHint") ?? "Розклад"}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-slate-300" />
                          </div>
                        </Link>
                      ) : (
                        <div className="ds-pop-in rounded-[18px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]" style={{ borderLeft: "3.5px solid #3b82f6" }}>
                          <p className="text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>{t("dashboardPageExtra.findTutor")}</p>
                          <p className="mt-0.5 text-[14px]" style={{ color: "var(--ds-sub)" }}>{t("studentPages.noTutorHint") ?? "Знайдіть репетитора"}</p>
                          <div className="mt-3">
                            <FindTutorDialog trigger={
                              <Button size="sm" className="rounded-xl h-11" style={{ background: "var(--teal)", color: "#0f0f1a" }}>
                                {t("dashboardPageExtra.leaveRequest")}
                              </Button>
                            } />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {/* Tutors (independent + hub): dynamic onboarding bonus tasks (parity) */}
                  {(isIndependentTutor || isHubTutor) && !obProgress.loading && (
                    <>
                      {pendingBonusTasks.length === 0 ? (
                        <div className="rounded-[16px] bg-white px-5 py-5 text-center shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
                          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "rgba(43,191,170,0.12)" }}>
                            <TrendingUp className="h-4 w-4" style={{ color: "var(--teal)" }} />
                          </div>
                          <p className="text-[15px] font-semibold" style={{ color: "var(--ds-txt)" }}>Кабінет налаштовано на 100% 🎉</p>
                          <p className="mt-1 text-[14px]" style={{ color: "var(--ds-sub)" }}>Всі підсилювачі підключені. Чудова робота!</p>
                        </div>
                      ) : (
                        pendingBonusTasks.map((task) => (
                          <div key={task.action} className="ds-pop-in flex items-center gap-0 overflow-hidden rounded-[16px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                            style={{ borderLeft: "3.5px solid #2BBFAA" }}>
                            {task.action === "ai" ? (
                              <button type="button" onClick={() => setAiNotesOpen(true)} className="flex flex-1 items-center gap-3 py-3.5 pl-4 pr-2 group hover:bg-muted/50 transition-colors min-w-0 text-left">
                                <span className="text-xl flex-shrink-0">{task.emoji}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[15px] font-semibold leading-tight" style={{ color: "var(--ds-txt)" }}>{task.title}</p>
                                  <p className="mt-0.5 text-[14px] leading-snug" style={{ color: "var(--ds-sub)" }}>{task.desc}</p>
                                </div>
                                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 group-hover:translate-x-0.5 transition-transform" />
                              </button>
                            ) : (
                            <Link to={task.to} className="flex flex-1 items-center gap-3 py-3.5 pl-4 pr-2 group hover:bg-muted/50 transition-colors min-w-0">
                              <span className="text-xl flex-shrink-0">{task.emoji}</span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[15px] font-semibold leading-tight" style={{ color: "var(--ds-txt)" }}>{task.title}</p>
                                <p className="mt-0.5 text-[14px] leading-snug" style={{ color: "var(--ds-sub)" }}>{task.desc}</p>
                              </div>
                              <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            )}
                            <button
                              onClick={() => skipTask(task.action)}
                              className="flex-shrink-0 px-3 py-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                              title="Пропустити"
                              aria-label="Пропустити"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))
                      )}
                      {pendingBonusTasks.length > 0 && (
                        <Link to="/profile" className="flex items-center justify-center gap-1 mt-1 text-[14px] transition-colors hover:opacity-70"
                          style={{ color: "var(--sub,#6b7088)" }}>
                          Завжди можна підключити у Профілі →
                        </Link>
                      )}
                    </>
                  )}
                  {/* Non-independent tutor: static availability task */}
                  {(isTutor || isManager) && !isIndependentTutor && (
                    <Link to="/availability" className="block group">
                      <div className="ds-pop-in flex items-center gap-3 overflow-hidden rounded-[18px] bg-white py-3.5 pl-4 pr-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all active:scale-[0.98] group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.09)]" style={{ borderLeft: "3.5px solid #d0d3e0" }}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(208,211,224,0.25)" }}>
                          <CalendarPlus className="h-4 w-4" style={{ color: "var(--ds-sub)" }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold leading-tight" style={{ color: "var(--ds-txt)" }}>{t("dashboardPageExtra.updateHours")}</p>
                          <p className="mt-0.5 text-[14px]" style={{ color: "var(--ds-sub)" }}>{t("availabilityManagerExtra.clickToAdd") ?? "Тримайте календар актуальним"}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </div>
                    </Link>
                  )}
                  <div className="mt-1">
                    <TelegramLinkCard />
                  </div>

                </div>
              )}
            </section>
          </div>

          {/* Independent tutor: secondary stack */}
          {isIndependentTutor && (
            <>
              {/* Streak — after lessons+tasks on mobile, hidden on desktop (shows in right col) */}
              {streak && (
                <div className="lg:hidden">
                  <StreakCard streak={streak} />
                </div>
              )}
              {/* Trial banner — mobile only, placed under Streak */}
              <div className="lg:hidden">
                <TrialCountdownBanner />
              </div>
              <TutorWelcomeBanner />
            </>
          )}

          {/* Hub tutor: streak parity — the streak is computed for hub tutors too, so
              show the same momentum card the independent tutor gets (mobile). */}
          {isHubTutor && streak && (
            <div className="lg:hidden">
              <StreakCard streak={streak} />
            </div>
          )}
        </div>
      )}




      {/* ── FAB: expandable + with Урок / Учня / Оплату ──────────────────
          Managers run the HUB flows (all tutors+students), not the independent
          quick-dialogs — QuickLessonDialog/QuickAddStudentDialog query only the
          tutor's own source:'independent' rows, so for a manager they create a
          malformed record / show an empty list. Route managers to the canonical
          Schedule / People / Finances surfaces instead. */}
      {/* Hub tutor: ONE primary action — create a lesson via the canonical Schedule
          form (its student picker reads the hub students). The independent quick
          dialogs query source:'independent' rows → empty list for a hub tutor, and a
          hub tutor must NOT add students (the manager owns them). So PageFAB, not AddFab. */}
      {isHubTutor && <PageFAB onClick={() => navigate("/schedule?create=1")} />}
      {(isManager || isIndependentTutor) && (
        <AddFab
          onLesson={() => (isManager ? navigate("/schedule?create=1") : setQuickLessonOpen(true))}
          onStudent={() => (isManager ? navigate("/people?add=student") : setAddStudentOpen(true))}
          onPayment={() => (isManager ? navigate("/finances") : openPaymentSheet())}
        />
      )}
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
      <AiNotesDialog open={aiNotesOpen} onOpenChange={setAiNotesOpen} />
      <CloseDayDialog open={closeDayOpen} onOpenChange={setCloseDayOpen} rows={closeDayRows} onDone={() => loadData()} />
      <RecordPaymentSheet
        open={paymentSheetOpen}
        onOpenChange={setPaymentSheetOpen}
        pairs={paymentPairs}
        unpaidLessons={paymentUnpaid}
        onMarkLessonPaid={markPaymentLessonPaid}
        onWalletTopUp={() => loadData()}
      />
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

      <DayClosedCelebration
        show={showDayClosed}
        lessonCount={dayClosedCount}
        onDone={() => setShowDayClosed(false)}
      />
    </AppLayout>
  );
}
