import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Sparkles, Download, Clock, Check } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useHaptic } from "@/hooks/useHaptic";
import { burstConfetti } from "@/lib/confetti";
import { readHomeworkDone, writeHomeworkDone } from "@/lib/homeworkDone";

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
  storagePath: string | null;
}

export default function StudentHomeworkPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState<HomeworkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [doneSet, setDoneSet] = useState<Set<string>>(new Set());
  const haptic = useHaptic();

  useEffect(() => {
    setDoneSet(readHomeworkDone(user?.id));
  }, [user?.id]);

  // Personal "done" marker (local, per device). Marking complete celebrates;
  // unmarking is silent. Closes the homework loop without tutor-facing submission.
  const toggleDone = (lessonId: string) => {
    if (!user) return;
    setDoneSet((prev) => {
      const next = new Set(prev);
      const wasDone = next.has(lessonId);
      if (wasDone) next.delete(lessonId);
      else next.add(lessonId);
      writeHomeworkDone(user.id, next);
      if (!wasDone) {
        haptic.success();
        burstConfetti({ count: 14 });
        toast.success(t("studentPagesExtra.homeworkDoneToast"));
      }
      return next;
    });
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: details, error } = await supabase
        .from("lesson_details_student" as any)
        .select("lesson_id, homework, summary, fireflies_summary")
        .not("homework", "is", null);

      const lessonIds0 = Array.from(
        new Set(((details ?? []) as any[]).map((d) => d.lesson_id).filter(Boolean)),
      );
      const { data: lessonRows } = lessonIds0.length
        ? await supabase
            .from("lessons")
            .select("id, subject, starts_at, tutor_id, student_id")
            .in("id", lessonIds0)
        : { data: [] as any[] };
      const lessonMap: Record<string, any> = {};
      (lessonRows ?? []).forEach((l: any) => { lessonMap[l.id] = l; });
      const data = ((details ?? []) as any[]).map((d) => ({
        ...d,
        lessons: lessonMap[d.lesson_id],
      })).filter((d) => d.lessons);

      const tutorIds = Array.from(
        new Set(data.map((d) => d.lessons?.tutor_id).filter(Boolean)),
      );
      const { data: profiles } = tutorIds.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", tutorIds)
        : { data: [] as any[] };
      const pmap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => {
        pmap[p.id] = `${p.first_name} ${p.last_name}`.trim();
      });

      // Additively fetch attachments for these homework lessons from the existing
      // lesson_attachments table (same pattern as LessonAttachments.tsx). Wrapped so a
      // failure here can never break the homework list itself.
      const lessonIds = Array.from(
        new Set(((data ?? []) as any[]).map((d) => d.lesson_id).filter(Boolean)),
      );
      const fileMap: Record<string, string> = {};
      try {
        if (lessonIds.length) {
          const { data: atts } = await supabase
            .from("lesson_attachments")
            .select("lesson_id, storage_path")
            .in("lesson_id", lessonIds)
            .order("created_at", { ascending: false });
          (atts ?? []).forEach((a: any) => {
            // Keep the first (most recent) attachment per lesson.
            if (a.lesson_id && a.storage_path && !(a.lesson_id in fileMap)) {
              fileMap[a.lesson_id] = a.storage_path;
            }
          });
        }
      } catch (e) {
        console.error(e);
      }

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
          // Attachment data comes from the separate lesson_attachments table (fetched above).
          hasFile: Boolean(fileMap[d.lesson_id]),
          storagePath: fileMap[d.lesson_id] ?? null,
        }))
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
      setRows(list);
      setLoading(false);
      if (error) console.error(error);
    })();
  }, [user?.id]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  // Resolve a short-lived signed URL for the lesson attachment and open it
  // (same storage bucket/pattern as LessonAttachments.tsx). Guarded so it can
  // never break the page.
  const handleDownload = async (r: HomeworkRow) => {
    if (!r.storagePath || downloadingId) return;
    setDownloadingId(r.lesson_id);
    try {
      const { data, error } = await supabase.storage
        .from("lesson-attachments")
        .createSignedUrl(r.storagePath, 60);
      if (error || !data?.signedUrl) {
        console.error(error);
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error(e);
    } finally {
      setDownloadingId(null);
    }
  };

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

  const renderCard = (r: HomeworkRow) => {
    const done = doneSet.has(r.lesson_id);
    return (
    <li key={r.lesson_id} style={{ borderRadius: 18, border: done ? "1px solid rgba(34,197,94,.4)" : "1px solid #eceef3", background: done ? "#f6fdf8" : "#fff", padding: 14, transition: "background .2s, border-color .2s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, background: done ? "rgba(34,197,94,.14)" : "rgba(43,191,170,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{done ? "✅" : "📚"}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.subject}</p>
          <p style={{ fontSize: 13, color: "#6b7088", marginTop: 1 }}>{fmt(r.starts_at)} · {r.tutor_name}</p>
        </div>
        {done && (
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 10px", borderRadius: 999, background: "rgba(34,197,94,.16)", color: "#15803d", fontSize: 12, fontWeight: 800 }}>
            <Check size={13} strokeWidth={2.6} />{t("studentPagesExtra.markedDone")}
          </span>
        )}
      </div>
      <p style={{ marginTop: 11, whiteSpace: "pre-wrap", borderRadius: 13, background: "#fbfbfc", border: "1px solid #eceef3", padding: "11px 13px", fontSize: 14.5, lineHeight: 1.55, color: "#0f0f1a" }}>
        {r.homework}
      </p>
      {(r.hasAiNote || r.hasFile) && (
        <div style={{ display: "flex", gap: 9, marginTop: 11 }}>
          {r.hasAiNote && (
            <button type="button" style={goldBtn} onClick={() => setOpenNoteId(openNoteId === r.lesson_id ? null : r.lesson_id)} aria-expanded={openNoteId === r.lesson_id}>
              <Sparkles size={16} strokeWidth={1.8} />{t("studentPagesExtra.summaryBtn")}
            </button>
          )}
          {r.hasFile && (
            <button type="button" style={plainBtn} onClick={() => handleDownload(r)} disabled={downloadingId === r.lesson_id}>
              {downloadingId === r.lesson_id
                ? <Loader2 size={16} strokeWidth={1.8} className="animate-spin" />
                : <Download size={16} strokeWidth={1.8} />}
              {t("studentPagesExtra.downloadBtn")}
            </button>
          )}
        </div>
      )}
      {/* Completion loop — the student's core action gets a clear, rewarding control */}
      <button
        type="button"
        onClick={() => toggleDone(r.lesson_id)}
        aria-pressed={done}
        style={{
          marginTop: 11, width: "100%", height: 46, borderRadius: 13, cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 14.5,
          border: done ? "1px solid #eceef3" : "none",
          background: done ? "#fff" : "linear-gradient(135deg,#2BBFAA,#25a896)",
          color: done ? "#6b7088" : "#0f0f1a",
          boxShadow: done ? "none" : "0 8px 20px -8px rgba(43,191,170,.6)",
        }}
      >
        <Check size={17} strokeWidth={2.4} />
        {done ? t("studentPagesExtra.markedDone") : t("studentPagesExtra.markDone")}
      </button>
      {r.hasAiNote && openNoteId === r.lesson_id && (
        <p style={{ marginTop: 10, whiteSpace: "pre-wrap", borderRadius: 13, background: "#FFFCF4", border: "1px solid rgba(245,181,68,.35)", padding: "11px 13px", fontSize: 14.5, lineHeight: 1.55, color: "#0f0f1a" }}>
          {r.aiNote}
        </p>
      )}
    </li>
    );
  };

  const renderList = (itemsRaw: HomeworkRow[], emptyTitle: string) => {
    // Completed homework sinks to the bottom so the next thing to do is on top.
    const items = [...itemsRaw].sort((a, b) => Number(doneSet.has(a.lesson_id)) - Number(doneSet.has(b.lesson_id)));
    return items.length === 0 ? (
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
  };

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
