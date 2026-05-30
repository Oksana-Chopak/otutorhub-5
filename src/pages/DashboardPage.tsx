import { useEffect, useMemo, useState } from "react";
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
import { QuickLessonDialog } from "@/components/QuickLessonDialog";
import { useTutorGamification } from "@/hooks/useTutorGamification";
import { useBadgeUnlockToasts } from "@/hooks/useBadgeUnlockToasts";
import { LessonCard } from "@/components/LessonCard";
import { TutorNotesCard } from "@/components/TutorNotesCard";
import { NeedsMarkingCard } from "@/components/NeedsMarkingCard";
import { StreakCard } from "@/components/StreakCard";
import { QuickActionsFab } from "@/components/QuickActionsFab";

import { AutoCompleteLessonsCard } from "@/components/AutoCompleteLessonsCard";
import { QuickActionsCard } from "@/components/QuickActionsCard";
import { PageFAB } from "@/components/PageFAB";
import { SkeletonHero, SkeletonList, SkeletonStatCards } from "@/components/SkeletonCard";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NotificationBell } from "@/components/NotificationBell";
import { lessonSourceTint } from "@/components/SourceBadge";
import { EmptyState } from "@/components/EmptyState";
import { formatPrice } from "@/lib/currency";
import { insertNotification } from "@/lib/notifications";
import { getRandomEmoji, type RewardTheme } from "@/lib/rewardThemes";
import { DayClosedCelebration } from "@/components/DayClosedCelebration";
import { TopTutorBadge } from "@/components/TopTutorBadge";
import {
  CalendarDays,
  CalendarClock,
  Users,
  TrendingUp,
  Loader2,
  Video,
  AlertTriangle,
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

function burstConfetti() {
  const colors = ["#2BBFAA", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7"];
  for (let i = 0; i < 18; i++) {
    const el = document.createElement("div");
    const dx = (Math.random() - 0.5) * 220;
    const dy = -(80 + Math.random() * 120);
    const rot = Math.random() * 540;
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:45%",
      "width:8px",
      "height:8px",
      "border-radius:2px",
      `background:${colors[i % colors.length]}`,
      "z-index:9999",
      "pointer-events:none",
      `--dx:${dx}px`,
      `--dy:${dy}px`,
      `--rot:${rot}deg`,
      `animation:confetti-pop ${0.7 + Math.random() * 0.4}s ease-out forwards`,
      `animation-delay:${i * 25}ms`,
    ].join(";");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

type ProfitPeriod = "all" | "month" | "week";

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, roles, loading: authLoading } = useAuth();
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

  // First-session redirect: new independent tutor → /onboarding.
  // Uses localStorage so we only auto-redirect once per device per user.
  useEffect(() => {
    if (wsLoading || !user || !isIndependentTutor) return;
    if (settings?.onboarding_completed) return;
    const key = `onboarding_shown_${user.id}`;
    if (localStorage.getItem(key) === "1") return;
    localStorage.setItem(key, "1");
    navigate("/onboarding", { replace: true });
  }, [wsLoading, user?.id, isIndependentTutor, settings?.onboarding_completed, navigate]);

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tutorCount, setTutorCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [tutorReferralRequestCount, setTutorReferralRequestCount] = useState(0);
  const [supportRequestCount, setSupportRequestCount] = useState(0);
  const [studentsWithoutTutor, setStudentsWithoutTutor] = useState(0);
  const [studentTutorCount, setStudentTutorCount] = useState(0);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [walletPair, setWalletPair] = useState<{ tutor_id: string; student_id: string; tutor_name: string; student_name: string } | null>(null);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const [profitPeriod, setProfitPeriod] = useState<ProfitPeriod>("all");
  const [myStudentCount, setMyStudentCount] = useState<number | null>(null);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [quickLessonOpen, setQuickLessonOpen] = useState(false);
  const [showDayClosed, setShowDayClosed] = useState(false);
  const [dayClosedCount, setDayClosedCount] = useState(0);
  const [topPercentile, setTopPercentile] = useState<number | null>(null);

  const [defaultMeetingUrls, setDefaultMeetingUrls] = useState<Record<string, string>>({});
  const [pairCurrency, setPairCurrency] = useState<Record<string, string>>({});

  // Gamification: badge unlock toasts + streak card + referral nudge counters
  const gamification = useTutorGamification();
  const { badges, loading: gamificationLoading, streak } = gamification;

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
          .select("id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, tutor_payout, student_payment_status, tutor_payout_status, meeting_url, homework, summary, student_notes, source");
        if (isManager) q = (q as any).neq("source", "independent");
        return q.order("starts_at", { ascending: true });
      })(),
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
      const [{ count: trCount }, { count: srCount }] = await Promise.all([
        supabase
          .from("tutor_referral_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]),
        supabase
          .from("subscription_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["new", "in_progress"]),
      ]);
      setTutorReferralRequestCount(trCount ?? 0);
      setSupportRequestCount(srCount ?? 0);
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

    if (isIndependentTutor) {
      const { count } = await supabase
        .from("student_rates")
        .select("student_id", { count: "exact", head: true })
        .eq("tutor_id", user.id)
        .eq("source", "independent");
      setMyStudentCount(count ?? 0);
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
      burstConfetti();
      toast.success(t("dashboardExtra.lessonCompletedToast"), {
        description: streak?.current_streak
          ? t("dashboardExtra.lessonCompletedStreak", { count: streak.current_streak })
          : t("dashboardExtra.lessonCompletedGood"),
        duration: 4000,
      });
      gamification.refresh();

      // Award reward emoji to student
      const lesson = lessons.find((l) => l.id === lessonId);
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
      }
    }
  };

  const updatePayment = async (
    lessonId: string,
    field: "student_payment_status" | "tutor_payout_status",
    value: PaymentStatus,
  ) => {
    const paidAtField = field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";
    const { error } = await supabase
      .from("lesson_details")
      .upsert(
        {
          lesson_id: lessonId,
          [field]: value,
          [paidAtField]: value === "paid" ? new Date().toISOString() : null,
        } as any,
        { onConflict: "lesson_id" },
      );
    if (error) {
      toast.error(t("dashboardExtra.paymentFailed"));
      return;
    }
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, [field]: value } : l)));
    const lesson = lessons.find((l) => l.id === lessonId);
    if (value === "paid" && field === "student_payment_status" && lesson) {
      if (lesson.student_price > 0) {
        const firstName = profiles[lesson.student_id]?.split(" ")[0] ?? t("shared.student");
        const currency = pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] ?? "UAH";
        toast.success(
          t("dashboardExtra.paymentReceivedToast", {
            amount: formatPrice(lesson.student_price, currency, { decimals: 0 }),
            name: firstName,
          }),
          { duration: 4000 },
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

  const needsMarkLessons = useMemo(
    () => lessons.filter((l) => l.status === "scheduled" && new Date(l.starts_at).getTime() < nowMs),
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
    all: t("dashboardExtra.periodAll"),
    month: t("dashboardExtra.periodMonth"),
    week: t("dashboardExtra.periodWeek"),
  };

  const statusLabel: Record<LessonStatus, string> = {
    pending: t("dashboardExtra.statusPending"),
    scheduled: t("dashboardExtra.statusScheduled"),
    completed: t("dashboardExtra.statusCompleted"),
    cancelled: t("dashboardExtra.statusCancelled"),
  };

  const firstName = useMemo(() => {
    const fromProfile = user?.id ? profiles[user.id]?.split(" ")[0] : "";
    return fromProfile || user?.email?.split("@")[0] || "";
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
        icon: AlertTriangle,
        tone: "warning" as const,
        title: `${supportRequestCount} звернен${
          supportRequestCount === 1 ? "ня" : supportRequestCount < 5 ? "ня" : "ь"
        } у службу підтримки`,
        description: t("dashboardExtra.supportRequestsDesc"),
        to: "/subscription-requests",
        cta: t("dashboardExtra.supportRequestsCta"),
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
        to: "/schedule",
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
        to: "/schedule",
        cta: t("dashboardExtra.noRateCta"),
      });
    }
    return tasks;
  }, [
    isManager,
    pendingLessonRequests,
    pendingRequestCount,
    tutorReferralRequestCount,
    supportRequestCount,
    studentsWithoutTutor,
    lessonsWithoutPrice,
    lessonsWithoutMeeting,
    pendingPayments.length,
  ]);

  return (
    <AppLayout>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {/* Hero: dark on mobile, no dark bg on desktop */}
      <div className="-mx-4 -mt-4 mb-5 overflow-hidden rounded-b-[24px] lg:mx-0 lg:mt-0 lg:mb-6 lg:rounded-[18px]">
        <div
          className="relative px-5 py-5 lg:px-0 lg:py-0"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[22px] font-extrabold leading-tight text-white lg:text-foreground sm:text-[26px] lg:text-[28px]">
                {timeEmoji}{" "}
                {greeting},{" "}
                <span style={{ color: "var(--teal)" }}>{firstName}</span>
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-400 lg:text-muted-foreground">
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
              <p className="mt-3 line-clamp-2 text-[13px] italic" style={{ color: "#8892b0" }}>
                ✨ {phraseOfDay}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
              {/* Golden bell — opens notification panel */}
              <NotificationBell golden className="h-11 w-11 rounded-full" />
              {/* Burger menu */}
              {isStudent && !isTutor && !isManager && (
                <FindTutorDialog
                  trigger={
                    <Button size="sm" className="h-11 rounded-xl text-[13px]" style={{ background: "var(--teal)" }}>
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
        <div className="space-y-6 sm:space-y-8">
          {isIndependentTutor && <TrialCountdownBanner />}
          {/* ── MANAGER: Profit dark card + 3 stat cards ─────────────── */}
          {isManager && (
            <>
              {/* Profit card — mobile/tablet only; lg uses 4-col grid */}
              <div
                className="overflow-hidden rounded-[18px] p-4 sm:p-5 lg:hidden"
                style={{ background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 100%)" }}
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "#6b7a99" }}>
                  💰 {t("dashboard.cardProfit")}
                </p>
                <p className="mt-2 text-[30px] font-extrabold leading-none" style={{ color: "var(--teal)" }}>
                  {formatPrice(profit, "UAH")}
                </p>
                <p className="mt-1 text-[13px] font-medium" style={{ color: "#22c55e" }}>
                  ↑ +12% {t("dashboard.periodMonth")}
                </p>
                <div className="mt-3 flex items-end gap-1" style={{ height: "20px" }}>
                  {[40, 55, 48, 72, 62, 85, 100].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: i === 6 ? "var(--teal)" : "rgba(43,191,170,0.2)" }} />
                  ))}
                </div>
              </div>
              {/* 3 stat cards — hidden on mobile, visible on desktop */}
              <div className="hidden sm:grid sm:grid-cols-3 sm:gap-3 lg:hidden">
                <Link to="/people" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#f0f1f5)" }}>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#9398b0)" }}>{t("dashboard.cardTutors")}</p>
                    <p className="mt-1 text-[26px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{tutorCount}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted,#b0b4c8)" }}>{t("dashboard.cardTutorsSub") || "активних"}</p>
                  </div>
                  <span style={{ color: "var(--border,#f0f1f5)", fontSize: "20px" }}>›</span>
                </Link>
                <Link to="/people" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#f0f1f5)" }}>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#9398b0)" }}>{t("dashboard.cardStudents")}</p>
                    <p className="mt-1 text-[26px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{studentCount}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted,#b0b4c8)" }}>{t("dashboard.cardStudentsSub") || "активних"}</p>
                  </div>
                  <span style={{ color: "var(--border,#f0f1f5)", fontSize: "20px" }}>›</span>
                </Link>
                <Link to="/schedule" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#f0f1f5)" }}>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#9398b0)" }}>{t("dashboard.todayLessons")}</p>
                    <p className="mt-1 text-[26px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{todayLessons.length}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: todayLessons.length === 0 ? "var(--muted)" : "var(--teal)" }}>{todayLessons.length === 0 ? (t("dashboard.todayFree") || "вільний день") : t("dashboard.lessonsToday")}</p>
                  </div>
                  <span style={{ color: "var(--border,#f0f1f5)", fontSize: "20px" }}>›</span>
                </Link>
              </div>
              {/* Desktop lg: all 4 in one row */}
              <div className="hidden lg:grid lg:grid-cols-4 lg:gap-3">
                <div
                  className="overflow-hidden rounded-[16px] p-4"
                  style={{ background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 100%)" }}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "#6b7a99" }}>💰 {t("dashboard.cardProfit")}</p>
                  <p className="mt-1.5 text-[24px] font-extrabold leading-none" style={{ color: "var(--teal)" }}>{formatPrice(profit, "UAH")}</p>
                  <p className="mt-0.5 text-[12px] font-medium" style={{ color: "#22c55e" }}>↑ +12%</p>
                  <div className="mt-2 flex items-end gap-0.5" style={{ height: "16px" }}>
                    {[40,55,48,72,62,85,100].map((h,i)=>(
                      <div key={i} className="flex-1 rounded-sm" style={{height:`${h}%`,background:i===6?"var(--teal)":"rgba(43,191,170,0.2)"}} />
                    ))}
                  </div>
                </div>
                <Link to="/people" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#f0f1f5)" }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#9398b0)" }}>{t("dashboard.cardTutors")}</p>
                    <p className="mt-1.5 text-[24px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{tutorCount}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted,#b0b4c8)" }}>{t("dashboard.cardTutorsSub")}</p>
                  </div>
                  <span style={{ color: "var(--border)", fontSize: "18px" }}>›</span>
                </Link>
                <Link to="/people" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#f0f1f5)" }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#9398b0)" }}>{t("dashboard.cardStudents")}</p>
                    <p className="mt-1.5 text-[24px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{studentCount}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted,#b0b4c8)" }}>{t("dashboard.cardStudentsSub")}</p>
                  </div>
                  <span style={{ color: "var(--border)", fontSize: "18px" }}>›</span>
                </Link>
                <Link to="/schedule" className="flex items-center justify-between rounded-[16px] border bg-white p-4 hover:shadow-sm transition-shadow" style={{ borderColor: "var(--border,#f0f1f5)" }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#9398b0)" }}>{t("dashboard.todayLessons")}</p>
                    <p className="mt-1.5 text-[24px] font-extrabold leading-none" style={{ color: "var(--txt,#0f0f1a)" }}>{todayLessons.length}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: todayLessons.length===0?"var(--muted)":"var(--teal)" }}>{todayLessons.length===0?t("dashboard.todayFree"):t("dashboard.lessonsToday")}</p>
                  </div>
                  <span style={{ color: "var(--border)", fontSize: "18px" }}>›</span>
                </Link>
              </div>
            </>
          )}

          {/* Hub tutor: Notes only — QuickActionsCard replaced by FAB button */}
          {(isManager || (isTutor && !isManager && !isIndependentTutor)) && (
            <div className="mt-4 space-y-4">
              <TutorNotesCard />
            </div>
          )}

          {/* Independent tutor: streak card — always visible so new tutors see "Почни сьогодні!" */}
          {isIndependentTutor && streak && (
            <StreakCard streak={streak} />
          )}

          {/* Top-10% badge */}
          {isTutor && !isManager && topPercentile !== null && topPercentile < 10 && (
            <TopTutorBadge percentile={topPercentile} />
          )}
          {isIndependentTutor && user && localStorage.getItem(`pending_invite_reminder_${user.id}`) === "1" && (
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <HandHeart className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Ви ще не запросили учня</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
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
                className="h-7 w-7 shrink-0"
                aria-label="Прибрати нагадування"
                onClick={() => {
                  localStorage.removeItem(`pending_invite_reminder_${user.id}`);
                  // Force re-render via state bump
                  setAddStudentOpen((v) => v);
                  loadData();
                }}
              >
                ×
              </Button>
            </div>
          )}
          {isTutor && !isManager && (
            <div className="mt-4">
              <PendingPaymentsCard />
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

          {needsMarkLessons.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-base font-semibold">{t("dashboardPageExtra.needsMarkingTitle")}</h2>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{needsMarkLessons.length}</span>
              </div>
              <div className="space-y-2">
                {needsMarkLessons.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] ?? 'UAH' }}
                    variant="schedule"
                    studentName={profiles[lesson.student_id] ?? '—'}
                    onContentClick={() => setOpenLessonId(lesson.id)}
                    className={lessonSourceTint(lesson.source)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── MANAGER: Pending payments list ─────────────────────────────── */}
          {isManager && (
            <div className="mt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub, #9398b0)" }}>
                  💰 {t("pendingPayments.title")}
                </p>
                {pendingPayments.length > 0 && (
                  <span className="text-[12px] font-semibold" style={{ color: "#f59e0b" }}>
                    {pendingPayments.length} {pendingPayments.length === 1 ? t("lessonCard.lesson") : t("lessonCard.lessons")}
                  </span>
                )}
              </div>

              {pendingPayments.length === 0 ? (
                /* Empty state — all paid */
                <div
                  className="flex flex-col items-center gap-3 rounded-[18px] bg-white px-5 py-7 text-center"
                  style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
                >
                  <span className="text-3xl">☀️</span>
                  <div>
                    <p className="text-[15px] font-semibold" style={{ color: "var(--txt, #0f0f1a)" }}>
                      {t("dashboard.allPaidTitle") || "Так тримати!"}
                    </p>
                    <p className="mt-1 text-[13px]" style={{ color: "var(--sub, #9398b0)" }}>
                      {t("dashboard.allPaidDesc") || "Усі уроки оплачені — все під контролем 🎉"}
                    </p>
                  </div>
                </div>
              ) : (
                /* Lesson cards — same style as schedule list */
                <div className="space-y-2.5">
                  {pendingPayments.slice(0, 5).map((lesson) => {
                    const tutorName = profiles[lesson.tutor_id] ?? "—";
                    const studentName = profiles[lesson.student_id] ?? "—";
                    const meetingHref = effectiveMeetingUrl(lesson);
                    return (
                      <LessonCard
                        key={lesson.id}
                        lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                        variant="schedule"
                        studentName={studentName}
                        tutorName={tutorName}
                        showTutor
                        meetingUrl={meetingHref}
                        onContentClick={() => setOpenLessonId(lesson.id)}
                        className={lessonSourceTint(lesson.source)}
                        extraActions={
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-11 gap-1.5 px-2 text-xs text-muted-foreground hover:text-primary"
                              onClick={() => setOpenLessonId(lesson.id)}
                            >
                              <CalendarClock className="h-4 w-4" />
                              <span className="hidden sm:inline">{t("schedule.reschedule")}</span>
                            </Button>
                            <Select
                              value={lesson.status}
                              onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                            >
                              <SelectTrigger className="h-11 w-[140px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(["scheduled", "completed", "cancelled"] as LessonStatus[]).map((s) => (
                                  <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </>
                        }
                        footer={
                          <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2">
                            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                              <span className="text-[11px] font-medium text-foreground whitespace-nowrap">
                                🎓 {formatPrice(lesson.student_price, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                              </span>
                              <Select
                                value={lesson.student_payment_status}
                                onValueChange={(v) => updatePayment(lesson.id, "student_payment_status", v as PaymentStatus)}
                              >
                                <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.student_payment_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                  <SelectItem value="paid">✓ Оплачено</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                              <span className="text-[11px] font-medium text-foreground whitespace-nowrap">
                                💼 {formatPrice(lesson.tutor_payout, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                              </span>
                              <Select
                                value={lesson.tutor_payout_status}
                                onValueChange={(v) => updatePayment(lesson.id, "tutor_payout_status", v as PaymentStatus)}
                              >
                                <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.tutor_payout_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                  <SelectItem value="paid">✓ Виплачено</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        }
                      />
                    );
                  })}
                  {pendingPayments.length > 5 && (
                    <button
                      className="w-full rounded-[14px] py-2.5 text-[13px] font-medium transition-colors"
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

          <div className="grid gap-5 md:grid-cols-5 md:gap-6">
            <section className="order-2 md:order-1 md:col-span-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub, var(--ds-sub))" }}>
                  {t("dashboard.upcomingLessons")}
                </p>
                {upcomingAll.length > todayPlusTomorrowLessons.length && (
                  <button
                    className="text-[12px] font-medium transition-colors hover:underline"
                    style={{ color: "var(--teal)" }}
                    onClick={() => setShowAllUpcoming((v) => !v)}
                  >
                    {showAllUpcoming ? t("dashboard.hide") : t("dashboard.showAll", { count: upcomingAll.length })}
                  </button>
                )}
              </div>
              <div className={`space-y-2.5 ${showAllUpcoming ? "max-h-[60vh] overflow-y-auto pr-1" : ""}`}>
                {upcomingLessons.length === 0 ? (
                  <div
                    className="flex flex-col items-center gap-3 rounded-[18px] bg-white px-5 py-7 text-center shadow-[0_1px_4px_rgba(0,0,0,0.05)]"
                  >
                    <span className="text-3xl">☀️</span>
                    <div>
                      {isIndependentTutor && (myStudentCount ?? 0) === 0 ? (
                        <>
                          <p className="text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>{t("dashboardPageExtra.addFirstStudent")}</p>
                          <p className="mt-0.5 text-[12px]" style={{ color: "var(--ds-sub)" }}>{t("dashboardPageExtra.addFirstStudentHint")}</p>
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
                          <p className="mt-0.5 text-[12px]" style={{ color: "var(--ds-sub)" }}>Сьогодні вільний день</p>
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
                    const studentName = profiles[lesson.student_id] ?? "—";

                    if (isManager && !isParticipant) {
                      const canEditStatus = true;
                      return (
                        <LessonCard
                          key={lesson.id}
                          lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                          variant="schedule"
                          studentName={studentName}
                          tutorName={tutorName}
                          showTutor
                          meetingUrl={meetingHref}
                          onContentClick={() => setOpenLessonId(lesson.id)}
                          className={lessonSourceTint(lesson.source)}
                          extraActions={
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[44px]"
                                onClick={() => setOpenLessonId(lesson.id)}
                                title={t("dashboardExtra.rescheduleLesson")}
                              >
                                <CalendarClock className="h-4 w-4" />
                                <span className="hidden sm:inline">{t("dashboardPageExtra.rescheduleBtn")}</span>
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                title={t("dashboardExtra.topUpWallet")}
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
                              {canEditStatus ? (
                                <Select
                                  value={lesson.status}
                                  onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                                >
                                  <SelectTrigger className="h-11 w-[140px] text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(["pending", "scheduled", "completed", "cancelled"] as LessonStatus[]).map((s) => (
                                      <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : null}
                            </>
                          }
                          footer={
                            <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2">
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  🎓 {formatPrice(lesson.student_price, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.student_payment_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "student_payment_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.student_payment_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                    <SelectItem value="paid">✓ Оплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  💼 {formatPrice(lesson.tutor_payout, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.tutor_payout_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "tutor_payout_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.tutor_payout_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                    <SelectItem value="paid">✓ Виплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          }
                        />
                      );
                    }

                    const partnerId =
                      user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id;
                    const canEditStatus = isManager || (isTutor && lesson.tutor_id === user?.id);

                    return (
                      <LessonCard
                        key={lesson.id}
                        lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                        variant="schedule"
                        studentName={studentName}
                        tutorName={tutorName}
                        showTutor={isManager}
                        meetingUrl={meetingHref}
                        chatPartnerId={partnerId}
                        onContentClick={() => setOpenLessonId(lesson.id)}
                        className={lessonSourceTint(lesson.source)}
                        extraActions={
                          canEditStatus ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11 gap-1.5 px-2 text-xs text-muted-foreground hover:text-primary"
                                onClick={() => setOpenLessonId(lesson.id)}
                                title={t("dashboardExtra.rescheduleLesson")}
                              >
                                <CalendarClock className="h-4 w-4" />
                                <span className="hidden sm:inline">{t("dashboardPageExtra.rescheduleBtn")}</span>
                              </Button>
                              <Select
                                value={lesson.status}
                                onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                              >
                                <SelectTrigger className="h-11 w-[140px] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(isManager
                                    ? (["pending", "scheduled", "completed", "cancelled"] as LessonStatus[])
                                    : (["scheduled", "completed", "cancelled"] as LessonStatus[])
                                  ).map((s) => (
                                    <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </>
                          ) : null
                        }
                        footer={
                          isManager ? (
                            <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2">
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  🎓 {formatPrice(lesson.student_price, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.student_payment_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "student_payment_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.student_payment_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                    <SelectItem value="paid">✓ Оплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                                  💼 {formatPrice(lesson.tutor_payout, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.tutor_payout_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "tutor_payout_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.tutor_payout_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                    <SelectItem value="paid">✓ Виплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          ) : null
                        }
                      />
                    );
                  })
                )}
              </div>
            </section>

            <section className="order-1 md:order-2 md:col-span-2">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub, var(--ds-sub))" }}>
                {t("dashboard.nextSteps")}
              </p>
              {isManager ? (
                <div className="space-y-2.5">
                  {smartTasks.length === 0 ? (
                    <div
                      className="rounded-[18px] bg-white px-5 py-5 text-center shadow-[0_1px_4px_rgba(0,0,0,0.05)]"
                    >
                      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "rgba(43,191,170,0.12)" }}>
                        <TrendingUp className="h-4 w-4" style={{ color: "var(--teal)" }} />
                      </div>
                      <p className="text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>{t("emptyState.allClear") || "Усе під контролем 🎉"}</p>
                      <p className="mt-1 text-[12px]" style={{ color: "var(--ds-sub)" }}>
                        Немає термінових задач.
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
                        <Link key={task.key} to={task.to} className="block group">
                          <div
                            className="ds-pop-in flex items-center gap-3 overflow-hidden rounded-[18px] bg-white py-3.5 pl-4 pr-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all duration-200 active:scale-[0.98] group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.09)]"
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
                              <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--ds-sub)" }}>
                                {task.description}
                              </p>
                            </div>
                            <ChevronRight className="ml-1 h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5" />
                          </div>
                        </Link>
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
                              <p className="mt-0.5 text-[12px]" style={{ color: "var(--ds-sub)" }}>{t("studentPages.tutorScheduleHint") ?? "Розклад"}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-slate-300" />
                          </div>
                        </Link>
                      ) : (
                        <div className="ds-pop-in rounded-[18px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]" style={{ borderLeft: "3.5px solid #3b82f6" }}>
                          <p className="text-[14px] font-semibold" style={{ color: "var(--ds-txt)" }}>{t("dashboardPageExtra.findTutor")}</p>
                          <p className="mt-0.5 text-[12px]" style={{ color: "var(--ds-sub)" }}>{t("studentPages.noTutorHint") ?? "Знайдіть репетитора"}</p>
                          <div className="mt-3">
                            <FindTutorDialog trigger={
                              <Button size="sm" className="rounded-xl h-11" style={{ background: "var(--teal)", color: "#fff" }}>
                                {t("dashboardPageExtra.leaveRequest")}
                              </Button>
                            } />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {(isTutor || isManager) && (
                    <Link to="/availability" className="block group">
                      <div className="ds-pop-in flex items-center gap-3 overflow-hidden rounded-[18px] bg-white py-3.5 pl-4 pr-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all active:scale-[0.98] group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.09)]" style={{ borderLeft: "3.5px solid #d0d3e0" }}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(208,211,224,0.25)" }}>
                          <CalendarPlus className="h-4 w-4" style={{ color: "var(--ds-sub)" }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold leading-tight" style={{ color: "var(--ds-txt)" }}>{t("dashboardPageExtra.updateHours")}</p>
                          <p className="mt-0.5 text-[12px]" style={{ color: "var(--ds-sub)" }}>{t("availabilityManagerExtra.clickToAdd") ?? "Тримайте календар актуальним"}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </div>
                    </Link>
                  )}
                  <div className="mt-1">
                    <TelegramLinkCard />
                  </div>
                  {/* Notes visible in right column on desktop */}
                  {(isTutor || isManager) && (
                    <div className="hidden md:block mt-1">
                      <TutorNotesCard />
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Mobile: notes below the grid (desktop shows in right col) */}
          {(isTutor || isManager) && !isIndependentTutor && (
            <div className="mt-2 md:hidden">
              <TutorNotesCard />
            </div>
          )}

          {/* Independent tutor: secondary stack */}
          {isIndependentTutor && (
            <>
              <IndependentTutorStats />
              <div className="mt-4 space-y-4">
                <TutorNotesCard />
              </div>
              <AutoCompleteLessonsCard />
              <div id="monthly-summary-anchor" className="mt-6 grid gap-4 lg:grid-cols-2">
                <MonthlySummaryCard />
                <ReferralWidget compact />
              </div>
              <TutorWelcomeBanner />
              <ReferralNudgeBanner
                completedLessons={myCompletedLessonsCount}
                invitedCount={referralInvitedCount}
              />
            </>
          )}
        </div>
      )}




      {/* ── FAB ───────────────────────────────────────────────────────────── */}
      {(isTutor || isManager) && (
        <PageFAB onClick={() => setQuickLessonOpen(true)} label={t("quickActions.title")} />
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

      <DayClosedCelebration
        show={showDayClosed}
        lessonCount={dayClosedCount}
        onDone={() => setShowDayClosed(false)}
      />
    </AppLayout>
  );
}
