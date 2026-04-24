import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isStudent = roles.includes("student");
  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tutorCount, setTutorCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [studentsWithoutTutor, setStudentsWithoutTutor] = useState(0);
  const [studentTutorCount, setStudentTutorCount] = useState(0);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [profitPeriod, setProfitPeriod] = useState<ProfitPeriod>("all");

  const loadData = async () => {
    if (!user) return;

    const [
      { data: lessonsData },
      { data: profilesData },
      { data: rolesData },
      { data: requestRows },
      { data: ratesData },
    ] = await Promise.all([
      supabase
        .from("lessons_visible")
        .select(
          "id, tutor_id, student_id, subject, starts_at, duration_minutes, status, student_price, tutor_payout, student_payment_status, tutor_payout_status, meeting_url, homework, summary, student_notes"
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
    ]);

    const profileMap: Record<string, string> = {};
    (profilesData as ProfileRow[] | null ?? []).forEach((profile) => {
      profileMap[profile.id] = `${profile.first_name} ${profile.last_name}`.trim() || "Без імені";
    });

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
    setLessons((lessonsData ?? []) as LessonRow[]);
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
  const upcomingLessons = showAllUpcoming ? upcomingAll : upcomingAll.slice(0, 5);

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
      lessons.filter(
        (l) =>
          l.status === "completed" &&
          new Date(l.starts_at).getTime() >= periodStart
      ),
    [lessons, periodStart]
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
      lessons.filter(
        (l) =>
          l.status === "completed" &&
          (l.student_payment_status === "unpaid" || l.tutor_payout_status === "unpaid")
      ),
    [lessons]
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

  const lessonsWithoutMeeting = useMemo(
    () =>
      lessons.filter(
        (l) =>
          l.status === "scheduled" &&
          new Date(l.starts_at).getTime() >= nowMs &&
          (!l.meeting_url || !l.meeting_url.trim())
      ).length,
    [lessons, nowMs]
  );

  const pendingLessonRequests = useMemo(
    () => lessons.filter((l) => l.status === "pending").length,
    [lessons]
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
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">Дашборд</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isManager ? "Керуйте уроками, людьми та оплатами" : "Огляд ваших занять"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <>
              <Button asChild variant="outline"><Link to="/people">Люди</Link></Button>
              <Button asChild variant="outline"><Link to="/schedule">Уроки</Link></Button>
              <Button asChild><Link to="/finances">Оплати</Link></Button>
            </>
          )}
          {(isTutor || isStudent) && !isManager && (
            <>
              {isTutor && (
                <Button asChild>
                  <Link to="/schedule">
                    <Plus className="h-4 w-4" />
                    Створити урок
                  </Link>
                </Button>
              )}
              {isStudent && !isTutor && (
                <FindTutorDialog
                  trigger={
                    <Button>
                      <HandHeart className="h-4 w-4" />
                      Запит на репетитора
                    </Button>
                  }
                />
              )}
              {isTutor && (
                <Button asChild variant="outline">
                  <Link to="/availability">
                    <CalendarPlus className="h-4 w-4" />
                    Оновити години
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
          {isManager && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard label="Репетитори" value={tutorCount} icon={Users} to="/people" />
              <StatCard label="Учні" value={studentCount} icon={Users} to="/people" />
              <StatCard label="Уроків сьогодні" value={todayLessons.length} icon={CalendarDays} to="/schedule" />
              <div className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-success/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      Прибуток
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
                    <SelectItem value="all">За весь час</SelectItem>
                    <SelectItem value="month">За цей місяць</SelectItem>
                    <SelectItem value="week">За цей тиждень</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className={`${isManager ? "mt-8 " : ""}grid gap-4 lg:grid-cols-[1.2fr,0.8fr]`}>
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-foreground">Найближчі уроки</h2>
                {upcomingAll.length > 5 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAllUpcoming((v) => !v)}
                  >
                    {showAllUpcoming ? "Сховати" : `Показати всі (${upcomingAll.length})`}
                  </Button>
                )}
              </div>
              <div className={`space-y-3 ${showAllUpcoming ? "max-h-[60vh] overflow-y-auto pr-1" : ""}`}>
                {upcomingLessons.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                    Найближчих уроків немає.
                    {isTutor && !isManager && (
                      <Button asChild size="sm" className="ml-3">
                        <Link to="/schedule">Створити урок</Link>
                      </Button>
                    )}
                    {isStudent && !isTutor && !isManager && (
                      <span className="ml-3 inline-block">
                        <FindTutorDialog
                          trigger={<Button size="sm">Запит на репетитора</Button>}
                        />
                      </span>
                    )}
                  </div>
                ) : (
                  upcomingLessons.map((lesson) => {
                    const lessonDate = new Date(lesson.starts_at);
                    const lessonDayKey = lesson.starts_at.slice(0, 10);
                    const isToday = lessonDayKey === todayKey;
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const dayAfter = new Date();
                    dayAfter.setDate(dayAfter.getDate() + 2);
                    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
                    const dayAfterKey = dayAfter.toISOString().slice(0, 10);
                    const weekday = lessonDate.toLocaleDateString("uk-UA", { weekday: "long" });
                    const weekdayCap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
                    const timeStr = lessonDate.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
                    let dayPart: string;
                    if (isToday) dayPart = "Сьогодні";
                    else if (lessonDayKey === tomorrowKey) dayPart = `Завтра · ${weekdayCap}`;
                    else if (lessonDayKey === dayAfterKey) dayPart = `Післязавтра · ${weekdayCap}`;
                    else
                      dayPart = `${weekdayCap}, ${lessonDate.toLocaleDateString("uk-UA", { day: "numeric", month: "short" })}`;
                    const timeLabel = `${dayPart} · ${timeStr}`;

                    const isParticipant = user?.id === lesson.tutor_id || user?.id === lesson.student_id;
                    const hasMeeting = !!(lesson.meeting_url && lesson.meeting_url.trim());

                    if (isManager && !isParticipant) {
                      return (
                        <Link
                          key={lesson.id}
                          to="/schedule"
                          className="flex items-center justify-between rounded-xl border border-border bg-card p-4 gap-3 transition-colors hover:border-primary/40 hover:bg-accent/30"
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                              <Clock className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{lesson.subject}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {profiles[lesson.tutor_id] ?? "—"} → {profiles[lesson.student_id] ?? "—"}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-sm font-medium text-foreground">{timeLabel}</span>
                            <Badge className={statusClass[lesson.status]}>{statusLabel[lesson.status]}</Badge>
                          </div>
                        </Link>
                      );
                    }

                    return (
                      <Collapsible key={lesson.id} className="rounded-xl border border-border bg-card">
                        <div className="flex items-center justify-between gap-3 p-4">
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                              <Clock className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{lesson.subject}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {profiles[lesson.tutor_id] ?? "—"} → {profiles[lesson.student_id] ?? "—"}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-sm font-medium text-foreground">{timeLabel}</span>
                            <Badge className={statusClass[lesson.status]}>{statusLabel[lesson.status]}</Badge>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
                          {hasMeeting ? (
                            <Button asChild size="sm" variant="default">
                              <a href={lesson.meeting_url!} target="_blank" rel="noopener noreferrer">
                                <Video className="mr-2 h-4 w-4" />
                                Приєднатися
                              </a>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Без посилання на мітинг</span>
                          )}
                          <CollapsibleTrigger asChild>
                            <Button size="sm" variant="ghost" className="group">
                              Деталі
                              <ChevronDown className="ml-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent className="border-t border-border p-4">
                          <LessonWorkspace
                            lessonId={lesson.id}
                            tutorId={lesson.tutor_id}
                            studentId={lesson.student_id}
                            meetingUrl={lesson.meeting_url}
                            homework={lesson.homework}
                            summary={lesson.summary}
                            studentNotes={lesson.student_notes}
                            onUpdated={loadData}
                          />
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Що зробити далі</h2>
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
                  {isTutor && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <StickyNote className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">Внести нотатку про урок</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Відкрийте найближчий урок і додайте конспект чи домашнє завдання.
                          </p>
                          <Button asChild size="sm" className="mt-3"><Link to="/schedule">До уроків</Link></Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {(isTutor || (isStudent && studentTutorCount > 0) || isManager) && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <CalendarPlus className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {isTutor ? "Оновити доступні години" : "Запросити нові години"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {isTutor
                              ? "Тримайте календар актуальним, щоб учні бачили вільні слоти."
                              : "Якщо у репетитора немає вільних годин — попросіть оновити графік."}
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
    </AppLayout>
  );
}
