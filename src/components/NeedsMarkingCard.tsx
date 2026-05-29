import { useMemo, useState } from "react";
import { useHaptic } from "@/hooks/useHaptic";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Check, X, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface PastLesson {
  id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  student_id: string;
  source: "hub" | "independent";
}

interface Props {
  lessons: PastLesson[];
  studentNames: Record<string, string>;
  onChanged: () => void;
}

export function NeedsMarkingCard({ lessons, studentNames, onChanged }: Props) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = useMemo(() => {
    const now = Date.now();
    return lessons.filter((l) => {
      const ends = new Date(l.starts_at).getTime() + l.duration_minutes * 60 * 1000;
      return ends < now;
    });
  }, [lessons]);

  if (items.length === 0) return null;

  const { success: hapticSuccess } = useHaptic();

  const setStatus = async (id: string, status: "completed" | "cancelled") => {
    setBusyId(id);
    if (status === "completed") hapticSuccess();
    const { error } = await supabase.from("lessons").update({ status }).eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error(t("needsMarking.updateFailed"));
      return;
    }
    toast.success(status === "completed" ? t("needsMarking.markedCompleted") : t("needsMarking.markedCancelled"));
    onChanged();
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="mt-6">
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15">
            <Clock className="h-4 w-4 text-warning" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("needsMarking.title", { count: items.length })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("needsMarking.desc")}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {items.slice(0, 5).map((l) => (
            <div
              key={l.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {l.subject} · {studentNames[l.student_id] ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmt(l.starts_at)}
                  {l.source === "hub" && (
                    <span className="ml-2 italic">{t("needsMarking.managerNote")}</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyId === l.id}
                  onClick={() => setStatus(l.id, "completed")}
                >
                  {busyId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("needsMarking.completed")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === l.id}
                  onClick={() => setStatus(l.id, "cancelled")}
                >
                  <X className="h-3.5 w-3.5" />
                  {t("needsMarking.cancelled")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
