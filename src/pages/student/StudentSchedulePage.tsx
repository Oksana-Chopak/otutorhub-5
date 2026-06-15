import { useEffect, useState } from "react";
import { getLocale } from "@/lib/locale";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Video } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { safeHref } from "@/lib/safeUrl";
import { useTranslation } from "react-i18next";

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
        .eq("student_id", user.id)
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

  const now = Date.now();
  const upcoming = lessons.filter((l) => new Date(l.starts_at).getTime() >= now);
  const past = lessons.filter((l) => new Date(l.starts_at).getTime() < now);

  const D = "Inter, system-ui, sans-serif";
  const renderList = (items: Lesson[]) => {
    if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t("studentPagesExtra.noLessonsInTab")}</p>;
    return (
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
        {items.map((l) => {
          const sm = STATUS_META[l.status] ?? STATUS_META.scheduled;
          const d = new Date(l.starts_at);
          const isCancelled = l.status === "cancelled";
          return (
            <li key={l.id} style={{ display: "flex", alignItems: "stretch", borderRadius: 16, border: "1px solid #eceef3", overflow: "hidden", background: "#fff", opacity: isCancelled ? 0.7 : 1 }}>
              <div style={{ position: "relative", width: 78, flexShrink: 0, background: "linear-gradient(160deg,#23232f 0%,#0f0f1a 100%)", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 4px", textAlign: "center" }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: sm.accent }} />
                <span style={{ fontFamily: D, fontWeight: 700, fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>
                  {d.toLocaleDateString(getLocale(), { weekday: "short" }).replace(".", "")}
                </span>
                <span style={{ fontFamily: D, fontWeight: 800, fontSize: 13 }}>
                  {d.toLocaleDateString(getLocale(), { day: "numeric", month: "short" }).replace(".", "")}
                </span>
                <span style={{ fontFamily: D, fontWeight: 800, fontSize: 19, letterSpacing: "-.02em", color: sm.accent, marginTop: 2 }}>
                  {d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <p style={{ fontFamily: D, fontWeight: 700, fontSize: 15.5, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.subject}</p>
                    <span style={{ flexShrink: 0, height: 24, padding: "0 9px", borderRadius: 999, display: "inline-flex", alignItems: "center", fontFamily: D, fontWeight: 700, fontSize: 13, background: sm.bg, color: sm.fg }}>
                      {statusLabel[l.status]}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: "#6b7088", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l.duration_minutes} {t("lessonCard.min")} · {l.tutor_name}
                  </p>
                </div>
                {l.meeting_url && l.status === "scheduled" && (
                  <a href={safeHref(l.meeting_url)} target="_blank" rel="noreferrer" aria-label="Zoom"
                    style={{ width: 44, height: 44, borderRadius: 14, flexShrink: 0, background: "#2BBFAA", color: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px -6px rgba(43,191,170,.7)" }}>
                    <Video size={20} />
                  </a>
                )}
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
            <TabsTrigger value="past">{t("studentPagesExtra.past", { count: past.length })}</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4">{renderList(upcoming)}</TabsContent>
          <TabsContent value="past" className="mt-4">{renderList(past)}</TabsContent>
        </Tabs>
      </div>
    </StudentLayout>
  );
}
