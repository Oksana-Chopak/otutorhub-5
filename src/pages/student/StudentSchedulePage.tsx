import { useEffect, useState } from "react";
import { getLocale } from "@/lib/locale";
import { Link } from "react-router-dom";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Video, MessageCircle, Clock } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { safeHref } from "@/lib/safeUrl";
import { useTranslation } from "react-i18next";
import { SkeletonList } from "@/components/SkeletonCard";
import { studentLessonsOrFilter } from "@/lib/studentLessons";

interface Lesson {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  meeting_url: string | null;
  tutor_id: string;
  tutor_name?: string;
}

const STATUS_META: Record<string, { accent: string; bg: string; fg: string }> = {
  pending:   { accent: "#f59e0b", bg: "rgba(245,158,11,.16)",  fg: "#b4740b" },
  scheduled: { accent: "#2BBFAA", bg: "rgba(43,191,170,.14)",  fg: "#1f8e7e" },
  completed: { accent: "#4ade80", bg: "rgba(34,197,94,.16)",   fg: "#16a34a" },
  cancelled: { accent: "#9aa0b4", bg: "rgba(147,152,176,.18)", fg: "#7b8198" },
};

export default function StudentSchedulePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<Lesson[]>([]);

  const statusLabel: Record<string, string> = {
    scheduled: t("studentPages.statusScheduled"),
    completed: t("studentPages.statusCompleted"),
    cancelled: t("studentPages.statusCancelled"),
    pending: t("studentPages.statusPending"),
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("lessons")
        .select("id, subject, starts_at, duration_minutes, status, meeting_url, tutor_id")
        .or(await studentLessonsOrFilter(user.id))
        .order("starts_at", { ascending: false });
      const tutorIds = Array.from(new Set(((data ?? []) as Lesson[]).map((l) => l.tutor_id)));
      const { data: profiles } = tutorIds.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", tutorIds)
        : { data: [] as any[] };
      const map: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => {
        map[p.id] = `${p.first_name} ${p.last_name}`.trim();
      });
      setLessons(((data ?? []) as Lesson[]).map((l) => ({ ...l, tutor_name: map[l.tutor_id] })));
      setLoading(false);
    })();
  }, [user?.id]);

  // Tick every 30s so the time-aware "live" join window flips on/off without a manual
  // refresh (it was frozen at first render, so the glowing «Приєднатися зараз» never
  // appeared on time).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const upcoming = lessons.filter((l) => new Date(l.starts_at).getTime() >= now);
  const past = lessons.filter((l) => new Date(l.starts_at).getTime() < now);

  const D = "Inter, system-ui, sans-serif";
  const renderList = (items: Lesson[]) => {
    if (loading) return <SkeletonList count={3} />;
    if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t("studentPagesExtra.noLessonsInTab")}</p>;
    return (
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
        {items.map((l) => {
          const sm = STATUS_META[l.status] ?? STATUS_META.scheduled;
          const d = new Date(l.starts_at);
          const isCancelled = l.status === "cancelled";
          // Time-aware join: "live" from 15 min before start through lesson end.
          const startMs = d.getTime();
          const endMs = startMs + (l.duration_minutes ?? 60) * 60000;
          const live = l.status === "scheduled" && now >= startMs - 15 * 60000 && now <= endMs;
          const minsTo = Math.round((startMs - now) / 60000);
          const isToday = d.toDateString() === new Date().toDateString();
          const joinStatus = live
            ? (now >= startMs ? t("studentPages.lessonLive") : t("studentPages.startsInMin", { min: Math.max(1, minsTo) }))
            : null;
          // A malformed meeting_url (no http/https scheme) → safeHref() = "#", a dead
          // button. Treat it as NO link so we show the honest "coming soon" fallback.
          const joinHref = safeHref(l.meeting_url);
          const hasJoinLink = joinHref !== "#" && l.status === "scheduled";
          return (
            <li key={l.id} style={{ display: "flex", alignItems: "stretch", borderRadius: 16, border: "0.5px solid var(--border)", overflow: "hidden", background: "#fff", opacity: isCancelled ? 0.7 : 1 }}>
              <div style={{ position: "relative", width: 78, flexShrink: 0, background: "linear-gradient(160deg,#23232f 0%,#0f0f1a 100%)", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 4px", textAlign: "center" }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: sm.accent }} />
                <span style={{ fontFamily: D, fontWeight: 700, fontSize: 14, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>
                  {d.toLocaleDateString(getLocale(), { weekday: "short" }).replace(".", "")}
                </span>
                <span style={{ fontFamily: D, fontWeight: 800, fontSize: 14 }}>
                  {d.toLocaleDateString(getLocale(), { day: "numeric", month: "short" }).replace(".", "")}
                </span>
                <span style={{ fontFamily: D, fontWeight: 800, fontSize: 19, letterSpacing: "-.02em", color: sm.accent, marginTop: 2 }}>
                  {d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 9, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <p style={{ fontFamily: D, fontWeight: 700, fontSize: 15.5, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.subject}</p>
                      <span style={{ flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, display: "inline-flex", alignItems: "center", fontFamily: D, fontWeight: 700, fontSize: 14, background: live ? "rgba(43,191,170,.18)" : sm.bg, color: live ? "#1f8e7e" : sm.fg }}>
                        {joinStatus ?? statusLabel[l.status]}
                      </span>
                    </div>
                    <p style={{ fontSize: 14, color: "var(--sub,#6b7088)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {l.duration_minutes} {t("lessonCard.min")} · {l.tutor_name}
                    </p>
                  </div>
                  <Link to={`/chats?with=${l.tutor_id}`} aria-label={t("studentPages.chatWithTutorAria")}
                    style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: "rgba(43,191,170,.12)", color: "#1f8e7e", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px rgba(43,191,170,.28)" }}>
                    <MessageCircle size={18} />
                  </Link>
                </div>
                {hasJoinLink ? (
                  <a href={joinHref} target="_blank" rel="noreferrer"
                    aria-label={live ? t("studentPages.joinNow") : t("studentPages.joinLesson")}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      height: 46, borderRadius: 13, fontFamily: D, fontWeight: 800, fontSize: 15, textDecoration: "none",
                      background: live ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "rgba(43,191,170,.12)",
                      color: live ? "#0f0f1a" : "#1f8e7e",
                      boxShadow: live ? "0 8px 20px -6px rgba(43,191,170,.7)" : "inset 0 0 0 1px rgba(43,191,170,.28)",
                      animation: live ? "joinPulse 1.8s ease-in-out infinite" : "none",
                    }}>
                    <Video size={19} /> {live ? t("studentPages.joinNow") : t("studentPages.joinLesson")}
                  </a>
                ) : (!hasJoinLink && l.status === "scheduled" && isToday) ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 12px", borderRadius: 12, background: "#F5F4F0", color: "#9398b0", fontSize: 14, fontWeight: 600 }}>
                    <Clock size={15} /> {t("studentPages.linkComingSoon")}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">{t("studentPages.scheduleTitle")}</h1>
        <Tabs defaultValue="upcoming">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upcoming">{t("studentPagesExtra.upcoming", { count: upcoming.length })}</TabsTrigger>
            <TabsTrigger value="past">{t("studentPagesExtra.pastSchedule", { count: past.length })}</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4">{renderList(upcoming)}</TabsContent>
          <TabsContent value="past" className="mt-4">{renderList(past)}</TabsContent>
        </Tabs>
      </div>
    </StudentLayout>
  );
}
