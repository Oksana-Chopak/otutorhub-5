import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
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
import { AutoCompletePromptDialog } from "@/components/AutoCompletePromptDialog";
import { AutoCompleteLessonsCard } from "@/components/AutoCompleteLessonsCard";
import { QuickActionsCard } from "@/components/QuickActionsCard";
import { lessonSourceTint } from "@/components/SourceBadge";
import { formatPrice } from "@/lib/currency";
import {
  CalendarDays,
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
      { data: lessonsData, error: lessonsError },
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

    if (lessonsError) {
      toast.error("Не вдалося завантажити дані. Перевірте з'єднання.");
      setLoading(false);
      return;
    }

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

    setLoading(false);
  };

  const updateStatus = async (lessonId: string, newStatus: LessonStatus) => {
    const { error } = await supabase.from("lessons").update({ status: newStatus }).eq("id", lessonId);
    if (error) {
      toast.error("Не вдалося змінити статус уроку. Спробуйте ще раз.");
      return;
    }
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, status: newStatus } : l)));
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
      toast.error("Не вдалося оновити оплату. Спробуйте ще раз.");
      return;
    }
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, [field]: value } : l)));
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

  const needsMarkLessons = useMemo(
    () => lessons.filter((l) => l.status === 'scheduled' && new Date(l.starts_at) < new Date()),
    [lessons, nowMs]
  );

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

  const statusLabel: Record<LessonStatus, string> = {
    pending: "Запит",
    scheduled: "Заплановано",
    completed: "Проведено",
    cancelled: "Скасовано",
  };

  const firstName = useMemo(() => {
    const fromProfile = user?.id ? profiles[user.id]?.split(" ")[0] : "";
    return fromProfile || user?.email?.split("@")[0] || "";
  }, [profiles, user?.email, user?.id]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Доброго ранку";
    if (hour < 18) return "Доброго дня";
    return "Доброго вечора";
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
        title: `Очікують оплати: ${pendingPayments.length}`,
        description: "Завершені уроки без повної оплати або виплати.",
        to: "/finances",
        cta: "Перейти до фінансів",
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
        description: "Учні залишили заявку — підберіть фахівця.",
        to: "/referrals",
        cta: "Переглянути заявки",
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
        description: "Репетитори надіслали запитання — дайте відповідь.",
        to: "/subscription-requests",
        cta: "Відкрити звернення",
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
        description: "Призначте ставку — без неї не буде ні уроків, ні чатів.",
        to: "/people",
        cta: "Відкрити людей",
      });
    }
    // 5. Lessons without meeting link
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
    // Lower-priority items (kept for completeness)
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
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 p-6 shadow-[0_8px_32px_-12px_hsl(var(--primary)/0.25)] sm:mb-8 sm:p-8">
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-primary/10" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-28 w-28 rounded-full bg-primary/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {greeting}{firstName ? `, ${firstName}` : ""}! <span className="ml-1">{timeEmoji}</span>
            </h1>
            <p className="mt-3 max-w-lg text-sm italic text-muted-foreground">
              <span className="not-italic font-medium text-primary/80">Афірмація дня: </span>
              {phraseOfDay}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 rounded-lg bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                Сьогодні {todayLessons.length}{" "}
                {todayLessons.length === 1 ? "урок" : todayLessons.length < 5 && todayLessons.length !== 0 ? "уроки" : "уроків"}
              </div>
              {pendingPayments.length > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-warning">
                  <Clock className="h-3.5 w-3.5" />
                  {pendingPayments.length} очікують оплати
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {isManager && (
              <>
                <Button asChild variant="outline" size="sm"><Link to="/people">{t("dashboard.btnPeople")}</Link></Button>
                <Button asChild size="icon" title={t("dashboard.btnPayments")} aria-label={t("dashboard.btnPayments")}>
                  <Link to="/finances"><Wallet className="h-4 w-4" /></Link>
                </Button>
              </>
            )}
            {isTutor && !isManager && (
              <Button size="sm" onClick={() => setQuickLessonOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("dashboard.btnCreateLesson")}
              </Button>
            )}
            {isStudent && !isTutor && !isManager && (
              <FindTutorDialog
                trigger={
                  <Button size="sm">
                    <HandHeart className="h-4 w-4" />
                    {t("dashboard.btnRequestTutor")}
                  </Button>
                }
              />
            )}
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
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6 sm:space-y-8">
          {isIndependentTutor && <TrialCountdownBanner />}
          {isManager && (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <StatCard label={t("dashboard.cardTutors")} value={tutorCount} icon={Users} to="/people" />
              <StatCard label={t("dashboard.cardStudents")} value={studentCount} icon={Users} to="/people" />
              <StatCard label={t("dashboard.todayLessons")} value={todayLessons.length} icon={CalendarDays} to="/schedule" />
              <div className="rounded-2xl border border-border bg-card p-2.5 transition-colors hover:border-success/40">
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground">
                      {t("dashboard.cardProfit")}
                    </p>
                    <Link to="/finances" className="block">
                      <p
                        className={`mt-0.5 truncate font-display text-base font-bold sm:text-lg ${
                          profit >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {formatPrice(profit, "UAH")}
                      </p>
                    </Link>
                  </div>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                  </div>
                </div>
                <Select value={profitPeriod} onValueChange={(v) => setProfitPeriod(v as ProfitPeriod)}>
                  <SelectTrigger className="mt-1.5 h-6 w-full text-[10px]">
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
          {isIndependentTutor && <AutoCompleteLessonsCard />}
          {(isTutor || isManager) && (
            <div className="mt-4 space-y-4">
              <QuickActionsCard onChanged={loadData} />
              <TutorNotesCard />
            </div>
          )}
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

          {needsMarkLessons.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-base font-semibold">Потребують відмітки</h2>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{needsMarkLessons.length}</span>
              </div>
              <div className="space-y-2">
                {needsMarkLessons.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}_${lesson.student_id}`] ?? 'UAH' }}
                    variant="schedule"
                    studentName={profiles[lesson.student_id] ?? '—'}
                    onContentClick={() => setOpenLessonId(lesson.id)}
                    className={lessonSourceTint(lesson.source)}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-6 lg:gap-8 xl:grid-cols-2">
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

            <section>
              <h2 className="mb-5 font-display text-lg font-semibold text-foreground">{t("dashboard.nextSteps")}</h2>
              {isManager ? (
                <div className="space-y-4">
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
                          className={`flex items-start gap-3 rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.12)] ${toneClass}`}
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">{task.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                            <Button asChild size="sm" className="mt-3">
                              <Link to={task.to}>{task.cta}</Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <TelegramLinkCard />
                </div>
              ) : (
                <div className="space-y-4">
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
                  <TelegramLinkCard />
                </div>
              )}
            </section>
          </div>
        </div>
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
