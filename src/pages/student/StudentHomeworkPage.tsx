import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Sparkles, Download, Clock } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";

interface HomeworkRow {
  lesson_id: string;
  homework: string;
  subject: string;
  starts_at: string;
  tutor_id: string;
  tutor_name?: string;
  hasAiNote: boolean;
  aiNote: string;
  hasFile: boolean;
}

export default function StudentHomeworkPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState<HomeworkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("lesson_details")
        .select("lesson_id, homework, summary, fireflies_summary, lessons!inner(subject, starts_at, tutor_id, student_id)")
        .eq("lessons.student_id", user.id)
        .not("homework", "is", null);

      const tutorIds = Array.from(
        new Set(((data ?? []) as any[]).map((d) => d.lessons?.tutor_id).filter(Boolean)),
      );
      const { data: profiles } = tutorIds.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", tutorIds)
        : { data: [] as any[] };
      const pmap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => {
        pmap[p.id] = `${p.first_name} ${p.last_name}`.trim();
      });

      const list: HomeworkRow[] = ((data ?? []) as any[])
        .filter((d) => d.homework && d.homework.trim())
        .map((d) => ({
          lesson_id: d.lesson_id,
          homework: d.homework,
          subject: d.lessons.subject,
          starts_at: d.lessons.starts_at,
          tutor_id: d.lessons.tutor_id,
          tutor_name: pmap[d.lessons.tutor_id],
          hasAiNote: Boolean((d.summary && d.summary.trim()) || (d.fireflies_summary && d.fireflies_summary.trim())),
          aiNote: (d.summary?.trim() || d.fireflies_summary?.trim() || ""),
          // Attachment data lives in the separate lesson_attachments table, which this
          // page does not fetch. Left false until that data is wired (see followups).
          hasFile: false,
        }))
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
      setRows(list);
      setLoading(false);
      if (error) console.error(error);
    })();
  }, [user?.id]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  // Архів = ДЗ з минулих уроків; Активні = майбутні/нещодавні. Розподіл за датою уроку.
  const { active, archive } = useMemo(() => {
    const now = Date.now();
    const active: HomeworkRow[] = [];
    const archive: HomeworkRow[] = [];
    rows.forEach((r) => {
      (new Date(r.starts_at).getTime() < now ? archive : active).push(r);
    });
    return { active, archive };
  }, [rows]);

  const goldBtn: React.CSSProperties = {
    flex: 1, height: 44, borderRadius: 11, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13,
    border: "1px solid rgba(245,181,68,.45)", background: "rgba(245,181,68,.14)", color: "#9a6a12",
  };
  const plainBtn: React.CSSProperties = {
    flex: 1, height: 44, borderRadius: 11, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13,
    border: "1px solid #eceef3", background: "#fff", color: "#0f0f1a",
  };

  const renderCard = (r: HomeworkRow) => (
    <li key={r.lesson_id} style={{ borderRadius: 18, border: "1px solid #eceef3", background: "#fff", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, background: "rgba(43,191,170,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>📚</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.subject}</p>
          <p style={{ fontSize: 13, color: "#6b7088", marginTop: 1 }}>{fmt(r.starts_at)} · {r.tutor_name}</p>
        </div>
      </div>
      <p style={{ marginTop: 11, whiteSpace: "pre-wrap", borderRadius: 13, background: "#fbfbfc", border: "1px solid #eceef3", padding: "11px 13px", fontSize: 14.5, lineHeight: 1.55, color: "#0f0f1a" }}>
        {r.homework}
      </p>
      <div style={{ display: "flex", gap: 9, marginTop: 11 }}>
        {r.hasAiNote && (
          <button type="button" style={goldBtn} onClick={() => setOpenNoteId(openNoteId === r.lesson_id ? null : r.lesson_id)} aria-expanded={openNoteId === r.lesson_id}>
            <Sparkles size={16} strokeWidth={1.8} />{t("studentPagesExtra.summaryBtn")}
          </button>
        )}
        {r.hasFile && (
          <button type="button" style={plainBtn}>
            <Download size={16} strokeWidth={1.8} />{t("studentPagesExtra.downloadBtn")}
          </button>
        )}
        {!r.hasAiNote && !r.hasFile && (
          <span style={{ fontSize: 12, color: "#b0b4c8", padding: "8px 2px" }}>{t("studentPagesExtra.noAttachments")}</span>
        )}
      </div>
      {r.hasAiNote && openNoteId === r.lesson_id && (
        <p style={{ marginTop: 10, whiteSpace: "pre-wrap", borderRadius: 13, background: "#FFFCF4", border: "1px solid rgba(245,181,68,.35)", padding: "11px 13px", fontSize: 14.5, lineHeight: 1.55, color: "#0f0f1a" }}>
          {r.aiNote}
        </p>
      )}
    </li>
  );

  const renderList = (items: HomeworkRow[], emptyTitle: string) =>
    items.length === 0 ? (
      <div style={{ textAlign: "center", padding: "36px 16px", borderRadius: 16, border: "1px dashed #eceef3", background: "#fff" }}>
        <div style={{ fontSize: 38 }}>📚</div>
        <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, color: "#0f0f1a", marginTop: 8 }}>{emptyTitle}</p>
        <p style={{ fontSize: 14, color: "#6b7088", marginTop: 4 }}>{t("studentPagesExtra.noHomework")}</p>
      </div>
    ) : (
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map(renderCard)}
      </ul>
    );

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">{t("studentPages.homeworkTitle")}</h1>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 16px", borderRadius: 16, border: "1px dashed #eceef3", background: "#fff" }}>
            <div style={{ fontSize: 38 }}>📚</div>
            <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, color: "#0f0f1a", marginTop: 8 }}>{t("studentPagesExtra.noHomeworkTitle")}</p>
            <p style={{ fontSize: 14, color: "#6b7088", marginTop: 4 }}>{t("studentPagesExtra.noHomework")}</p>
          </div>
        ) : (
          <Tabs defaultValue="active">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="active">{t("studentPagesExtra.homeworkTabActive", { count: active.length })}</TabsTrigger>
              <TabsTrigger value="archive">{t("studentPagesExtra.homeworkTabArchive", { count: archive.length })}</TabsTrigger>
            </TabsList>
            <TabsContent value="active" className="mt-4">
              {renderList(active, t("studentPagesExtra.noHomeworkTitle"))}
            </TabsContent>
            <TabsContent value="archive" className="mt-4">
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#6b7088", margin: "0 2px 14px" }}>
                <Clock size={15} strokeWidth={1.8} style={{ color: "#b0b4c8", flexShrink: 0 }} />
                {t("studentPagesExtra.homeworkArchiveHint")}
              </div>
              {renderList(archive, t("studentPagesExtra.archiveEmptyTitle"))}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </StudentLayout>
  );
}
