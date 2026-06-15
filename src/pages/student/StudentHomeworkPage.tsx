import { useEffect, useState } from "react";
import { getLocale } from "@/lib/locale";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface HomeworkRow {
  lesson_id: string;
  homework: string;
  subject: string;
  starts_at: string;
  tutor_id: string;
  tutor_name?: string;
}

export default function StudentHomeworkPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState<HomeworkRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("lesson_details")
        .select("lesson_id, homework, lessons!inner(subject, starts_at, tutor_id, student_id)")
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
        }))
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
      setRows(list);
      setLoading(false);
      if (error) console.error(error);
    })();
  }, [user?.id]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">{t("studentPages.homeworkTitle")}</h1>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 16px", borderRadius: 18, border: "1px dashed #eceef3", background: "#fff" }}>
            <div style={{ fontSize: 38 }}>📚</div>
            <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, color: "#0f0f1a", marginTop: 8 }}>{t("studentPagesExtra.noHomeworkTitle")}</p>
            <p style={{ fontSize: 14, color: "#6b7088", marginTop: 4 }}>{t("studentPagesExtra.noHomework")}</p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r) => (
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </StudentLayout>
  );
}
