import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StudentLayout } from "@/components/student/StudentLayout";
import { StudentOnboarding } from "@/components/student/StudentOnboarding";
import { useStudentContext } from "@/hooks/useStudentContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Video, CalendarDays, DollarSign, BookOpen, Sparkles } from "lucide-react";
import { safeHref } from "@/lib/safeUrl";
import { useTranslation } from "react-i18next";
import { useStudentRewards } from "@/hooks/useStudentRewards";
import { RewardCollection } from "@/components/student/RewardCollection";
import { StudentProgressBar } from "@/components/student/StudentProgressBar";
import { ReviewPromptCard } from "@/components/ReviewPromptCard";

interface UpcomingLesson {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  meeting_url: string | null;
  tutor_id: string;
  tutor_name?: string;
}

interface CompletedLessonStat {
  starts_at: string;
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)}`;
}

export default function StudentDashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { loading: ctxLoading, hasQuiz, hasTutor, refresh } = useStudentContext();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showQuizAgain, setShowQuizAgain] = useState(false);

  const [upcoming, setUpcoming] = useState<UpcomingLesson[]>([]);
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);
  const [homeworkCount, setHomeworkCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completedLessons, setCompletedLessons] = useState<CompletedLessonStat[]>([]);

  const { rewards, loading: rewardsLoading } = useStudentRewards();

  const { completedCount, weeklyCount, weeklyRecord } = useMemo(() => {
    const count = completedLessons.length;
    const thisWeek = getISOWeek(new Date());
    const byWeek: Record<string, number> = {};
    for (const l of completedLessons) {
      const wk = getISOWeek(new Date(l.starts_at));
      byWeek[wk] = (byWeek[wk] ?? 0) + 1;
    }
    const wkCount = byWeek[thisWeek] ?? 0;
    const record = Math.max(0, ...Object.values(byWeek));
    return { completedCount: count, weeklyCount: wkCount, weeklyRecord: record };
  }, [completedLessons]);

  useEffect(() => {
    if (!ctxLoading && !hasQuiz) setShowOnboarding(true);
  }, [ctxLoading, hasQuiz]);

  const loadDashboard = async () => {
    if (!user) return;
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: lessons }, { data: details }, { data: completed }] = await Promise.all([
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
      supabase
        .from("lessons")
        .select("starts_at")
        .eq("student_id", user.id)
        .eq("status", "completed"),
    ]);
    setCompletedLessons((completed as CompletedLessonStat[] | null) ?? []);

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
      tutor_name: profileMap[l.tutor_id] ?? t("studentPages.tutorFallback"),
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

  const DS = {
    teal: "#2BBFAA", tealD: "#1f8e7e", tealL: "#f0fdf9", txt: "#0f0f1a",
    sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3",
    display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };

  return (
    <StudentLayout>
      <div className="space-y-5" style={{ fontFamily: DS.body, color: DS.txt }}>
        <div>
          <h1 style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", lineHeight: 1.15 }}>{t("studentPages.greeting")}</h1>
          <p style={{ fontSize: 15, color: DS.sub, marginTop: 4 }}>{t("studentPages.greetingSub")}</p>
        </div>

        {/* Review prompt — invites a rating for the most recent unrated completed lesson */}
        <ReviewPromptCard />

        {/* Block 1: Upcoming lessons — DS cards with dark time rail */}
        <div style={{ borderRadius: 18, border: `1px solid ${DS.border}`, background: "#fff", padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: DS.display, fontWeight: 700, fontSize: 15.5 }}>
              <CalendarDays className="h-4 w-4" style={{ color: DS.teal }} /> {t("studentPages.upcomingLessonsTitle")}
            </h2>
            <Link to="/student/schedule" style={{ fontFamily: DS.display, fontWeight: 700, fontSize: 13, color: DS.tealD, textDecoration: "none" }}>
              {t("studentPages.allLessonsLink")} →
            </Link>
          </div>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : upcoming.length === 0 ? (
            <p style={{ fontSize: 14, color: DS.sub }}>{t("studentPages.noLessons")}</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
              {upcoming.map((l) => {
                const d = new Date(l.starts_at);
                const isToday = d.toDateString() === new Date().toDateString();
                return (
                  <li key={l.id} style={{ display: "flex", alignItems: "stretch", borderRadius: 16, border: `1px solid ${DS.border}`, overflow: "hidden", background: "#fff" }}>
                    <div style={{ width: 78, flexShrink: 0, background: "linear-gradient(160deg,#23232f 0%,#0f0f1a 100%)", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 4px", textAlign: "center" }}>
                      <span style={{ fontFamily: DS.display, fontWeight: 700, fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>
                        {isToday ? "Сьогодні" : d.toLocaleDateString("uk-UA", { weekday: "short" }).replace(".", "")}
                      </span>
                      {!isToday && (
                        <span style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 13 }}>
                          {d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }).replace(".", "")}
                        </span>
                      )}
                      <span style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.02em", color: DS.teal, marginTop: 3 }}>
                        {d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: DS.display, fontWeight: 700, fontSize: 15.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.subject}</p>
                        <p style={{ fontSize: 13, color: DS.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.tutor_name}</p>
                      </div>
                      {l.meeting_url ? (
                        <a href={safeHref(l.meeting_url)} target="_blank" rel="noreferrer" aria-label="Zoom"
                          style={{ width: 44, height: 44, borderRadius: 14, flexShrink: 0, background: DS.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px -6px rgba(43,191,170,.7)" }}>
                          <Video size={20} />
                        </a>
                      ) : (
                        <span style={{ flexShrink: 0, fontSize: 13, color: DS.muted, fontFamily: DS.body }}>{t("studentPages.noMeetingLink")}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Block 2 & 3: Quick stats — DS bubbles */}
        <div className="grid grid-cols-2 gap-3">
          <Link to="/student/payments" style={{ textDecoration: "none" }}>
            <div className="hover:shadow-sm transition-shadow" style={{ borderRadius: 18, border: `1px solid ${DS.border}`, background: "#fff", padding: "14px 15px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "rgba(245,181,68,.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <DollarSign className="h-5 w-5" style={{ color: "#b4740b" }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, color: DS.sub, fontFamily: DS.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPages.awaitingPayment")}</p>
                <p style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 24, color: DS.txt, lineHeight: 1.1 }}>{pendingPaymentsCount}</p>
              </div>
            </div>
          </Link>
          <Link to="/student/homework" style={{ textDecoration: "none" }}>
            <div className="hover:shadow-sm transition-shadow" style={{ borderRadius: 18, border: `1px solid ${DS.border}`, background: "#fff", padding: "14px 15px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "rgba(43,191,170,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BookOpen className="h-5 w-5" style={{ color: DS.tealD }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, color: DS.sub, fontFamily: DS.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPagesExtra.homeworkTitle")}</p>
                <p style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 24, color: DS.txt, lineHeight: 1.1 }}>{homeworkCount}</p>
              </div>
            </div>
          </Link>
        </div>

        {/* Block 4: Progress + personal record */}
        <StudentProgressBar
          completedCount={completedCount}
          weeklyCount={weeklyCount}
          weeklyRecord={weeklyRecord}
        />

        {/* Block 5: Reward collection */}
        <RewardCollection rewards={rewards} loading={rewardsLoading} />

        {/* Block 6: Find tutor (only if no tutor yet) */}
        {!hasTutor && (
          <div style={{ borderRadius: 18, padding: 16, background: "linear-gradient(135deg, rgba(43,191,170,.12), transparent)", border: "1px solid rgba(43,191,170,.28)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                <Sparkles size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 15.5 }}>{t("studentPagesExtra.searchingTutor")}</h3>
                <p style={{ fontSize: 13.5, color: DS.sub, marginTop: 3, lineHeight: 1.5 }}>
                  {t("studentPagesExtra.searchingTutorDesc")}
                </p>
                <button onClick={() => setShowQuizAgain(true)}
                  style={{ marginTop: 12, height: 42, padding: "0 16px", borderRadius: 12, border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff",
                    fontFamily: DS.display, fontWeight: 700, fontSize: 14, boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)" }}>
                  {t("studentPagesExtra.findTutorBtn")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </StudentLayout>
  );
}
