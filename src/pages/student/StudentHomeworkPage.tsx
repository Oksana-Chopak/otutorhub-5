import { useEffect, useState } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Loader2, BookOpen } from "lucide-react";

interface HomeworkRow {
  lesson_id: string;
  homework: string;
  subject: string;
  starts_at: string;
  tutor_id: string;
  tutor_name?: string;
}

export default function StudentHomeworkPage() {
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

      const { data: profiles } = await supabase.from("profiles").select("id, first_name, last_name");
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
    new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">Домашні завдання</h1>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />
            Поки що немає домашніх завдань
          </Card>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.lesson_id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{r.subject}</p>
                      <p className="text-xs text-muted-foreground">{fmt(r.starts_at)} · {r.tutor_name}</p>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-foreground">
                    {r.homework}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </StudentLayout>
  );
}
