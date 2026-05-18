import { useEffect, useState } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Video } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { safeHref } from "@/lib/safeUrl";

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

const statusLabel: Record<string, string> = {
  scheduled: t("studentPages.statusScheduled"),
  completed: t("studentPages.statusCompleted"),
  cancelled: t("studentPages.statusCancelled"),
  pending: t("studentPages.statusPending"),
};
const statusClass: Record<string, string> = {
  scheduled: "bg-primary/10 text-primary",
  completed: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
  pending: "bg-warning/10 text-warning",
};

export default function StudentSchedulePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<Lesson[]>([]);

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

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("uk-UA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const renderList = (items: Lesson[]) => {
    if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Уроків немає</p>;
    return (
      <ul className="space-y-3">
        {items.map((l) => (
          <li key={l.id}>
            <Card className="p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{l.subject}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass[l.status]}`}>
                      {statusLabel[l.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmt(l.starts_at)} · {l.duration_minutes} хв · {l.tutor_name}</p>
                </div>
                {l.meeting_url && l.status === "scheduled" && (
                  <Button asChild size="sm">
                    <a href={safeHref(l.meeting_url)} target="_blank" rel="noreferrer">
                      <Video className="mr-1 h-3.5 w-3.5" /> Zoom
                    </a>
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">{t("studentPages.scheduleTitle")}</h1>
        <Tabs defaultValue="upcoming">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upcoming">Майбутні ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past">Архів ({past.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4">{renderList(upcoming)}</TabsContent>
          <TabsContent value="past" className="mt-4">{renderList(past)}</TabsContent>
        </Tabs>
      </div>
    </StudentLayout>
  );
}
