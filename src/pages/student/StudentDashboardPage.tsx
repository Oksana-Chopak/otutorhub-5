import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StudentLayout } from "@/components/student/StudentLayout";
import { StudentOnboarding } from "@/components/student/StudentOnboarding";
import { useStudentContext } from "@/hooks/useStudentContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Video, CalendarDays, DollarSign, BookOpen, Sparkles } from "lucide-react";
import { safeHref } from "@/lib/safeUrl";

interface UpcomingLesson {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  meeting_url: string | null;
  tutor_id: string;
  tutor_name?: string;
}

export default function StudentDashboardPage() {
  const { user } = useAuth();
  const { loading: ctxLoading, hasQuiz, hasTutor, refresh } = useStudentContext();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showQuizAgain, setShowQuizAgain] = useState(false);

  const [upcoming, setUpcoming] = useState<UpcomingLesson[]>([]);
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);
  const [homeworkCount, setHomeworkCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ctxLoading && !hasQuiz) setShowOnboarding(true);
  }, [ctxLoading, hasQuiz]);

  const loadDashboard = async () => {
    if (!user) return;
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: lessons }, { data: details }] = await Promise.all([
      supabase
        .from("lessons")
        .select("id, subject, starts_at, duration_minutes, meeting_url, tutor_id, status, student_payment_status")
        .eq("student_id", user.id)
        .eq("status", "scheduled")
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(3),
      supabase
        .from("lesson_details")
        .select("lesson_id, homework, student_payment_status, lessons!inner(student_id)")
        .eq("lessons.student_id", user.id),
    ]);

    const tutorIds = Array.from(new Set((lessons ?? []).map((l: any) => l.tutor_id)));
    const { data: profiles } = tutorIds.length
      ? await supabase.from("profiles").select("id, first_name, last_name").in("id", tutorIds)
      : { data: [] as any[] };

    const profileMap: Record<string, string> = {};
    (profiles ?? []).forEach((p: any) => {
      profileMap[p.id] = `${p.first_name} ${p.last_name}`.trim();
    });

    const upcomingList: UpcomingLesson[] = (lessons ?? []).map((l: any) => ({
      ...l,
      tutor_name: profileMap[l.tutor_id] ?? "Репетитор",
    }));
    setUpcoming(upcomingList);

    const detailsArr = (details ?? []) as any[];
    setHomeworkCount(detailsArr.filter((d) => d.homework && d.homework.trim()).length);
    setPendingPaymentsCount(
      detailsArr.filter((d) => d.student_payment_status === "unpaid").length
    );

    setLoading(false);
  };

  useEffect(() => {
    if (!showOnboarding) loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showOnboarding]);

  if (ctxLoading) {
    return (
      <StudentLayout>
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </StudentLayout>
    );
  }

  if (showOnboarding || showQuizAgain) {
    return (
      <StudentLayout>
        <StudentOnboarding
          onComplete={async () => {
            setShowOnboarding(false);
            setShowQuizAgain(false);
            await refresh();
          }}
        />
      </StudentLayout>
    );
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("uk-UA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <StudentLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Привіт! 👋</h1>
          <p className="text-sm text-muted-foreground">Тут зібрано все найважливіше для тебе.</p>
        </div>

        {/* Block 1: Upcoming lessons */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <CalendarDays className="h-4 w-4 text-primary" /> Найближчі уроки
            </h2>
            <Link to="/student/schedule" className="text-xs text-primary hover:underline">
              Усі уроки →
            </Link>
          </div>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Поки немає запланованих уроків.</p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((l) => (
                <li key={l.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{l.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(l.starts_at)} · {l.tutor_name}
                    </p>
                  </div>
                  {l.meeting_url ? (
                    <Button asChild size="sm" variant="default">
                      <a href={safeHref(l.meeting_url)} target="_blank" rel="noreferrer">
                        <Video className="mr-1 h-3.5 w-3.5" /> Zoom
                      </a>
                    </Button>
                  ) : (
                    <Badge variant="outline" className="w-fit text-xs">без посилання</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Block 2 & 3: Quick stats */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/student/payments">
            <Card className="p-5 transition-shadow hover:shadow-md">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <DollarSign className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Очікують оплати</p>
                  <p className="text-xl font-bold text-foreground">{pendingPaymentsCount}</p>
                </div>
              </div>
            </Card>
          </Link>
          <Link to="/student/homework">
            <Card className="p-5 transition-shadow hover:shadow-md">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Домашні завдання</p>
                  <p className="text-xl font-bold text-foreground">{homeworkCount}</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>

        {/* Block 4: Find tutor (only if no tutor yet) */}
        {!hasTutor && (
          <Card className="border-primary/30 bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 shrink-0 text-primary" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Шукаємо тобі репетитора</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Менеджер уже отримав твою заявку. Якщо хочеш — заповни ще одну для іншого предмета.
                </p>
                <Button className="mt-3" size="sm" onClick={() => setShowQuizAgain(true)}>
                  Знайти репетитора
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </StudentLayout>
  );
}
