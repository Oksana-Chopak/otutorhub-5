import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getLocale } from "@/lib/locale";
import { openExternal } from "@/lib/openExternal";
import { Loader2, Paperclip, ChevronDown } from "lucide-react";

/**
 * Матеріали учня одним списком (рішення власниці 11.09).
 *
 * БУЛО: «Історія» — згорнутий список дат із ПЕРШИМ рядком конспекту, без
 * посилань. Щоб прочитати конспект чи домашку, репетиторка стрибала від уроку
 * до уроку й тримала в голові, де що лежить.
 *
 * СТАЛО: хронологія матеріалів, розгорнута одразу. Кожен урок — картка:
 * конспект, домашка, приватна нотатка, прикріплені файли. Видно, ЩО в учня
 * взагалі є, без жодного кліку; клік потрібен лише щоб відкрити сам урок або
 * завантажити файл.
 *
 * Уроки БЕЗ матеріалів у список не потрапляють: це перелік того, що є, а не
 * ще один журнал відвідувань — він живе в розкладі.
 *
 * Приватні нотатки (`lesson_tutor_notes`) бачить ЛИШЕ репетитор: RLS віддає
 * їх автору, і компонент не питає їх у режимі учня взагалі.
 */
export interface MaterialItem {
  lessonId: string;
  startsAt: string;
  subject: string | null;
  status: string;
  summary: string | null;
  homework: string | null;
  privateNote: string | null;
  files: { id: string; name: string; path: string }[];
}

const MAX_LESSONS = 40;

export function StudentMaterials({
  studentId,
  tutorId,
  onOpenLesson,
}: {
  studentId: string;
  /** Чиї уроки показуємо. Для репетитора — його власні. */
  tutorId: string;
  onOpenLesson?: (lessonId: string) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MaterialItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busyFile, setBusyFile] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setFailed(false);
    (async () => {
      try {
        // 07.09: перенесені борги — не уроки, матеріалів у них не буває.
        const base = () => supabase
          .from("lessons_visible")
          .select("id, starts_at, subject, status, carried_over")
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .order("starts_at", { ascending: false })
          .limit(MAX_LESSONS);
        let les: any[] | null = null;
        const first = await base();
        if (first.error) {
          // до міграції carried_over колонки немає — питаємо без неї
          const alt = await supabase
            .from("lessons_visible")
            .select("id, starts_at, subject, status")
            .eq("tutor_id", tutorId)
            .eq("student_id", studentId)
            .order("starts_at", { ascending: false })
            .limit(MAX_LESSONS);
          les = (alt.data as any[]) ?? [];
        } else {
          les = ((first.data as any[]) ?? []).filter((l) => l.carried_over !== true);
        }
        const ids = les.map((l) => l.id);
        if (ids.length === 0) { if (alive) setItems([]); return; }

        const [det, notes, atts] = await Promise.all([
          supabase.from("lesson_details").select("lesson_id, summary, homework").in("lesson_id", ids),
          (supabase as any).from("lesson_tutor_notes").select("lesson_id, notes").in("lesson_id", ids),
          supabase.from("lesson_attachments").select("id, lesson_id, file_name, storage_path").in("lesson_id", ids),
        ]);

        const dMap: Record<string, { summary: string | null; homework: string | null }> = {};
        ((det.data as any[]) ?? []).forEach((d) => { dMap[d.lesson_id] = { summary: d.summary ?? null, homework: d.homework ?? null }; });
        const nMap: Record<string, string> = {};
        ((notes?.data as any[]) ?? []).forEach((n) => { if ((n.notes ?? "").trim()) nMap[n.lesson_id] = n.notes; });
        const fMap: Record<string, MaterialItem["files"]> = {};
        ((atts.data as any[]) ?? []).forEach((a) => {
          (fMap[a.lesson_id] ??= []).push({ id: a.id, name: a.file_name, path: a.storage_path });
        });

        const list: MaterialItem[] = les
          .map((l) => ({
            lessonId: l.id,
            startsAt: l.starts_at,
            subject: l.subject ?? null,
            status: l.status,
            summary: (dMap[l.id]?.summary ?? "").trim() || null,
            homework: (dMap[l.id]?.homework ?? "").trim() || null,
            privateNote: nMap[l.id] ?? null,
            files: fMap[l.id] ?? [],
          }))
          .filter((i) => i.summary || i.homework || i.privateNote || i.files.length > 0);

        if (alive) setItems(list);
      } catch {
        if (alive) { setFailed(true); setItems([]); }
      }
    })();
    return () => { alive = false; };
  }, [studentId, tutorId]);

  const openFile = async (path: string, id: string) => {
    if (busyFile) return;
    setBusyFile(id);
    try {
      const { data } = await supabase.storage.from("lesson-attachments").createSignedUrl(path, 60);
      if (data?.signedUrl) void openExternal(data.signedUrl);
    } finally {
      setBusyFile(null);
    }
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "short", year: "numeric" });

  if (items === null) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 2px", fontSize: 15, color: "var(--sub,#666b82)" }}>
        <Loader2 className="h-4 w-4 animate-spin" /> {t("studentMaterials.loading")}
      </div>
    );
  }
  if (failed) {
    return <p style={{ fontSize: 15, color: "var(--sub,#666b82)", padding: "10px 2px" }}>{t("studentMaterials.failed")}</p>;
  }
  if (items.length === 0) {
    return <p style={{ fontSize: 15, color: "var(--sub,#666b82)", padding: "10px 2px" }}>{t("studentMaterials.empty")}</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it) => {
        const long = (it.summary ?? "").length > 260;
        const expanded = open[it.lessonId] ?? false;
        return (
          <div key={it.lessonId}
            style={{ borderRadius: 16, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: "var(--ds-txt,#0f0f1a)" }}>
                {fmt(it.startsAt)}{it.subject ? ` · ${it.subject}` : ""}
              </span>
              {onOpenLesson && (
                <button type="button" className="tap-44" onClick={() => onOpenLesson(it.lessonId)}
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 2px", fontSize: 15, fontWeight: 700, color: "#0F6E56", fontFamily: "Inter, system-ui, sans-serif" }}>
                  {t("studentMaterials.openLesson")} →
                </button>
              )}
            </div>

            {it.summary && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--sub,#666b82)", marginBottom: 4 }}>✨ {t("studentMaterials.summary")}</div>
                <p style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.55, color: "var(--ds-txt,#0f0f1a)", margin: 0,
                  maxHeight: long && !expanded ? 120 : undefined, overflow: long && !expanded ? "hidden" : undefined }}>
                  {it.summary}
                </p>
                {long && (
                  <button type="button" className="tap-44" onClick={() => setOpen((p) => ({ ...p, [it.lessonId]: !expanded }))}
                    style={{ marginTop: 4, border: "none", background: "transparent", cursor: "pointer", padding: "4px 0", fontSize: 15, fontWeight: 700, color: "#0F6E56", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {expanded ? t("studentMaterials.less") : t("studentMaterials.more")}
                    <ChevronDown size={15} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                  </button>
                )}
              </div>
            )}

            {it.homework && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--sub,#666b82)", marginBottom: 4 }}>📚 {t("studentMaterials.homework")}</div>
                <p style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.55, color: "var(--ds-txt,#0f0f1a)", margin: 0 }}>{it.homework}</p>
              </div>
            )}

            {it.privateNote && (
              <div style={{ marginTop: 10, borderRadius: 12, background: "#FFFCF4", border: "1px solid rgba(245,181,68,.35)", padding: "9px 12px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#9a6a12", marginBottom: 3 }}>🔒 {t("studentMaterials.privateNote")}</div>
                <p style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.5, color: "var(--ds-txt,#0f0f1a)", margin: 0 }}>{it.privateNote}</p>
              </div>
            )}

            {it.files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {it.files.map((f) => (
                  <button key={f.id} type="button" className="tap-44" disabled={busyFile === f.id} onClick={() => void openFile(f.path, f.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 13px", borderRadius: 11, cursor: "pointer",
                      border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface2,#fbfbfc)", color: "var(--ds-txt,#0f0f1a)", fontSize: 15, fontWeight: 600, maxWidth: "100%" }}>
                    {busyFile === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
