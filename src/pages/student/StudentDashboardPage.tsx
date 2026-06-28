import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { StudentOnboarding } from "@/components/student/StudentOnboarding";
import { useStudentContext } from "@/hooks/useStudentContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Video, CalendarDays, DollarSign, BookOpen, Sparkles, MessageCircle, Clock } from "lucide-react";
import { safeHref } from "@/lib/safeUrl";
import { useTranslation } from "react-i18next";
import { useStudentRewards } from "@/hooks/useStudentRewards";
import { RewardCollection } from "@/components/student/RewardCollection";
import { StudentProgressBar } from "@/components/student/StudentProgressBar";
import { ReviewPromptCard } from "@/components/ReviewPromptCard";
import { SkeletonList } from "@/components/SkeletonCard";
import { FindTutorDialog } from "@/components/FindTutorDialog";
import { readHomeworkDone } from "@/lib/homeworkDone";
import { studentLessonsOrFilter } from "@/lib/studentLessons";

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

  const [upcoming, setUpcoming] = useState<UpcomingLesson[]>([]);
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);
  const [homeworkCount, setHomeworkCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completedLessons, setCompletedLessons] = useState<CompletedLessonStat[]>([]);

  // Tick every 30s so the time-aware "live" join window flips ON/OFF without a manual
  // refresh. The window was computed once from a frozen Date.now(), so the glowing
  // «Приєднатися зараз» state never appeared until the page was reloaded.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
    const orFilter = await studentLessonsOrFilter(user.id);
    const [{ data: lessons }, { data: details }, { data: completed }, { data: groupParts }] = await Promise.all([
      supabase
        .from("lessons")
        .select("id, subject, starts_at, duration_minutes, meeting_url, tutor_id, status, student_payment_status")
        .or(orFilter)
        .eq("status", "scheduled")
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(3),
      supabase
        .from("lesson_details_student" as any)
        .select("lesson_id, homework, student_payment_status"),
      supabase
        .from("lessons")
        .select("starts_at")
        .or(orFilter)
        .eq("status", "completed"),
      // GROUP lessons: the view above (over lesson_details) has no row for them —
      // the student's price/payment lives on lesson_participants. Pull unpaid ones.
      supabase
        .from("lesson_participants")
        .select("student_payment_status, lessons!inner(status)")
        .eq("student_id", user.id)
        .neq("lessons.status", "cancelled"),
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
    // Drop homework the student has personally marked done (local checklist),
    // so finishing it on the Homework page is reflected here too.
    const hwDone = readHomeworkDone(user.id);
    setHomeworkCount(
      detailsArr.filter((d) => d.homework && d.homework.trim() && !hwDone.has(d.lesson_id)).length,
    );
    const unpaidGroup = ((groupParts ?? []) as any[]).filter(
      (p) => (p.student_payment_status ?? "unpaid") === "unpaid",
    ).length;
    setPendingPaymentsCount(
      detailsArr.filter((d) => d.student_payment_status === "unpaid").length + unpaidGroup,
    );

    setLoading(false);
  };

  useEffect(() => {
    if (!showOnboarding) loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showOnboarding]);

  if (ctxLoading) {
    return (
      <AppLayout>
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
          </div>
          <SkeletonList count={2} />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-[70px] animate-pulse rounded-[16px] border border-border bg-white" />
            <div className="h-[70px] animate-pulse rounded-[16px] border border-border bg-white" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (showOnboarding) {
    return (
      <AppLayout>
        <StudentOnboarding
          onComplete={async () => {
            setShowOnboarding(false);
            await refresh();
          }}
        />
      </AppLayout>
    );
  }

  const DS = {
    teal: "#2BBFAA", tealD: "#1f8e7e", tealL: "#f0fdf9", txt: "#0f0f1a",
    sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3",
    display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };

  return (
    <AppLayout>
      <div className="space-y-5" style={{ fontFamily: DS.body, color: DS.txt }}>
        <div>
          <h1 style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", lineHeight: 1.15 }}>{t("studentPages.greeting")}</h1>
          <p style={{ fontSize: 15, color: DS.sub, marginTop: 4 }}>{t("studentPages.greetingSub")}</p>
        </div>

        {/* Review prompt — invites a rating for the most recent unrated completed lesson */}
        <ReviewPromptCard />

        {/* Block 1: Upcoming lessons — DS cards with dark time rail */}
        <div style={{ borderRadius: 16, border: `1px solid ${DS.border}`, background: "#fff", padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: DS.display, fontWeight: 700, fontSize: 15.5 }}>
              <CalendarDays className="h-4 w-4" style={{ color: DS.teal }} /> {t("studentPages.upcomingLessonsTitle")}
            </h2>
            <Link to="/student/schedule" style={{ fontFamily: DS.display, fontWeight: 700, fontSize: 14, color: DS.tealD, textDecoration: "none" }}>
              {t("studentPages.allLessonsLink")} →
            </Link>
          </div>
          {loading ? (
            <SkeletonList count={2} />
          ) : upcoming.length === 0 ? (
            !hasTutor ? (
              // No tutor yet → don't promise a phantom "lesson coming soon".
              // Offer the real first action: request a tutor.
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px 2px" }}>
                <p style={{ fontSize: 14, color: DS.sub, lineHeight: 1.5 }}>{t("studentPages.noTutorYet")}</p>
                <FindTutorDialog
                  onCreated={refresh}
                  trigger={
                    <button
                      style={{ alignSelf: "flex-start", height: 44, padding: "0 18px", borderRadius: 12, border: "none", cursor: "pointer",
                        background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a",
                        fontFamily: DS.display, fontWeight: 700, fontSize: 14.5, display: "inline-flex", alignItems: "center", gap: 8,
                        boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}
                    >
                      <Sparkles size={17} /> {t("studentPages.requestTutorCta")}
                    </button>
                  }
                />
              </div>
            ) : (
              <p style={{ fontSize: 14, color: DS.sub }}>{t("studentPages.noLessons")}</p>
            )
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
              {upcoming.map((l) => {
                const d = new Date(l.starts_at);
                const isToday = d.toDateString() === new Date().toDateString();
                // Time-aware join: "live" from 15 min before start through the
                // lesson's end. That window pins the lesson and shows a glowing CTA.
                // `nowTick` (30s interval) drives this so it goes live without a refresh.
                const startMs = d.getTime();
                const endMs = startMs + (l.duration_minutes ?? 60) * 60000;
                const now = nowTick;
                const live = now >= startMs - 15 * 60000 && now <= endMs;
                // A malformed meeting_url (no http/https scheme) makes safeHref() return
                // "#", which renders a dead glowing button. Treat that as NO link and
                // fall through to the honest "link coming soon" state instead.
                const joinHref = safeHref(l.meeting_url);
                const hasJoinLink = joinHref !== "#";
                const minsTo = Math.round((startMs - now) / 60000);
                const joinStatus = live
                  ? (now >= startMs ? t("studentPages.lessonLive") : t("studentPages.startsInMin", { min: Math.max(1, minsTo) }))
                  : null;
                return (
                  <li key={l.id} style={{ display: "flex", alignItems: "stretch", borderRadius: 16, border: `1px solid ${DS.border}`, overflow: "hidden", background: "#fff" }}>
                    <div style={{ width: 78, flexShrink: 0, background: "linear-gradient(160deg,#23232f 0%,#0f0f1a 100%)", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 4px", textAlign: "center" }}>
                      <span style={{ fontFamily: DS.display, fontWeight: 700, fontSize: 14, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>
                        {isToday ? "Сьогодні" : d.toLocaleDateString(getLocale(), { weekday: "short" }).replace(".", "")}
                      </span>
                      {!isToday && (
                        <span style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 14 }}>
                          {d.toLocaleDateString(getLocale(), { day: "numeric", month: "short" }).replace(".", "")}
                        </span>
                      )}
                      <span style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.02em", color: DS.teal, marginTop: 3 }}>
                        {d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 9, padding: "10px 12px" }}>
                      {/* Top row: subject / tutor + (live status) + chat shortcut */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: DS.display, fontWeight: 700, fontSize: 15.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.subject}</p>
                          <p style={{ fontSize: 14, color: live ? DS.tealD : DS.sub, fontWeight: live ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {joinStatus ? `${joinStatus} · ${l.tutor_name ?? ""}` : l.tutor_name}
                          </p>
                        </div>
                        <Link to={`/chats?with=${l.tutor_id}`} aria-label={t("studentPages.chatWithTutorAria")}
                          style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: "rgba(43,191,170,.12)", color: DS.tealD, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px rgba(43,191,170,.28)" }}>
                          <MessageCircle size={18} />
                        </Link>
                      </div>
                      {/* Action row: labeled, time-aware join — never an empty/dead state */}
                      {hasJoinLink ? (
                        <a href={joinHref} target="_blank" rel="noreferrer"
                          aria-label={live ? t("studentPages.joinNow") : t("studentPages.joinLesson")}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                            height: 46, borderRadius: 13, fontFamily: DS.display, fontWeight: 800, fontSize: 15, textDecoration: "none",
                            background: live ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "rgba(43,191,170,.12)",
                            color: live ? "#0f0f1a" : DS.tealD,
                            boxShadow: live ? "0 8px 20px -6px rgba(43,191,170,.7)" : "inset 0 0 0 1px rgba(43,191,170,.28)",
                            animation: live ? "joinPulse 1.8s ease-in-out infinite" : "none",
                          }}>
                          <Video size={19} /> {live ? t("studentPages.joinNow") : t("studentPages.joinLesson")}
                        </a>
                      ) : isToday ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 12px", borderRadius: 12, background: "#F5F4F0", color: DS.sub, fontSize: 14, fontWeight: 600 }}>
                          <Clock size={15} /> {t("studentPages.linkComingSoon")}
                        </div>
                      ) : null}
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
            <div className="hover:shadow-sm transition-shadow" style={{ borderRadius: 16, border: `1px solid ${DS.border}`, background: "#fff", padding: "14px 15px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "rgba(245,181,68,.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <DollarSign className="h-5 w-5" style={{ color: "#b4740b" }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 14, color: DS.sub, fontFamily: DS.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPages.awaitingPayment")}</p>
                <p style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 24, color: DS.txt, lineHeight: 1.1 }}>{pendingPaymentsCount}</p>
              </div>
            </div>
          </Link>
          <Link to="/student/homework" style={{ textDecoration: "none" }}>
            <div className="hover:shadow-sm transition-shadow" style={{ borderRadius: 16, border: `1px solid ${DS.border}`, background: "#fff", padding: "14px 15px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "rgba(43,191,170,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BookOpen className="h-5 w-5" style={{ color: DS.tealD }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 14, color: DS.sub, fontFamily: DS.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPagesExtra.homeworkTitle")}</p>
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
              <div style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                <Sparkles size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontFamily: DS.display, fontWeight: 800, fontSize: 15.5 }}>{t("studentPagesExtra.searchingTutor")}</h3>
                <p style={{ fontSize: 14.5, color: DS.sub, marginTop: 3, lineHeight: 1.5 }}>
                  {t("studentPagesExtra.searchingTutorDesc")}
                </p>
                <FindTutorDialog
                  onCreated={refresh}
                  trigger={
                    <button
                      style={{ marginTop: 12, height: 42, padding: "0 16px", borderRadius: 12, border: "none", cursor: "pointer",
                        background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a",
                        fontFamily: DS.display, fontWeight: 700, fontSize: 14, boxShadow: "0 6px 16px -6px rgba(43,191,170,.7)" }}>
                      {t("studentPagesExtra.findTutorBtn")}
                    </button>
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
