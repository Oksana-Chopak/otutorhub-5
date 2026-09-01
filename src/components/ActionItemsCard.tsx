import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * №11 (ідеї 01.09): «дії, про які домовились на уроці» лежали на три тапи
 * вглиб (урок → розділ → Fireflies-панель). Ця картка піднімає
 * fireflies_action_items з уроків останніх 3 днів прямо на дашборд.
 *
 * SECURITY: контент Fireflies — ЛИШЕ для репетитора (інваріант: учні ніколи
 * не бачать fireflies_*). Картку рендерять тільки репетиторські гілки
 * дашборда; читання йде через lesson_details, де RLS це і так гарантує.
 */
type LessonAgreements = {
  lessonId: string;
  studentName: string;
  subject: string;
  startsAt: string;
  items: string[];
};

export function ActionItemsCard({ onOpenLesson }: { onOpenLesson?: (lessonId: string) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState<LessonAgreements[]>([]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (async () => {
      const since = new Date(Date.now() - 3 * 86400000).toISOString();
      const { data: lessons, error } = await supabase
        .from("lessons")
        .select("id, student_id, subject, starts_at")
        .eq("tutor_id", user.id)
        .eq("status", "completed")
        .gte("starts_at", since)
        .order("starts_at", { ascending: false })
        .limit(10);
      if (!alive || error || !lessons || lessons.length === 0) return;
      const ids = lessons.map((l) => l.id);
      const { data: details, error: dErr } = await supabase
        .from("lesson_details")
        .select("lesson_id, fireflies_action_items")
        .in("lesson_id", ids)
        .not("fireflies_action_items", "is", null);
      if (!alive || dErr || !details || details.length === 0) return;
      const itemsByLesson = new Map(
        (details as Array<{ lesson_id: string; fireflies_action_items: string[] | null }>)
          .filter((d) => (d.fireflies_action_items ?? []).length > 0)
          .map((d) => [d.lesson_id, d.fireflies_action_items as string[]]),
      );
      if (itemsByLesson.size === 0) return;
      const withItems = lessons.filter((l) => itemsByLesson.has(l.id)).slice(0, 2);
      const studentIds = Array.from(new Set(withItems.map((l) => l.student_id).filter(Boolean))) as string[];
      const names = new Map<string, string>();
      if (studentIds.length) {
        const { data: profs } = await supabase.from("profiles").select("id, first_name, last_name").in("id", studentIds);
        (profs ?? []).forEach((p: any) => names.set(p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()));
      }
      if (!alive) return;
      setRows(withItems.map((l) => ({
        lessonId: l.id,
        studentName: (l.student_id && names.get(l.student_id)) || l.subject,
        subject: l.subject,
        startsAt: l.starts_at,
        items: (itemsByLesson.get(l.id) ?? []).slice(0, 3),
      })));
    })();
    return () => { alive = false; };
  }, [user?.id]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-[16px] bg-card p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]" style={{ borderLeft: "3.5px solid #8b5cf6" }}>
      <p className="text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sub,#666b82)" }}>
        ✨ {t("actionItemsCard.title")}
      </p>
      <div className="mt-2.5 space-y-3">
        {rows.map((r) => (
          <div key={r.lessonId}>
            <button
              type="button"
              onClick={onOpenLesson ? () => onOpenLesson(r.lessonId) : undefined}
              className="text-left text-[14px] font-semibold underline-offset-2 hover:underline"
              style={{ color: "var(--ds-txt,#0f0f1a)" }}
            >
              {r.studentName}
              <span className="font-normal" style={{ color: "var(--ds-sub,#666b82)" }}>
                {" · "}
                {new Date(r.startsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
            </button>
            <ul className="mt-1 space-y-1">
              {r.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2 text-[14px] leading-snug" style={{ color: "var(--ds-sub)" }}>
                  <span aria-hidden className="mt-[2px] shrink-0" style={{ color: "#8b5cf6" }}>▸</span>
                  <span className="min-w-0">{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
