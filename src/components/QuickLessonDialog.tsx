import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  startsAt: Date | null;
  onCreated?: () => void;
  onWantFullForm?: (startsAt: Date) => void;
}

interface StudentRow {
  student_id: string;
  subject: string;
  price: number;
  name: string;
  default_meeting_url?: string | null;
}

const LAST_KEY = "tutorhub.lastQuickStudentId";

/**
 * Compact "click-to-create" dialog for independent tutors. Pre-fills student,
 * subject, price and meeting link from the previously used (or first) student.
 * One click → lesson created. Power users get the speed of a calendar app
 * without losing the option to open the full editor.
 */
export function QuickLessonDialog({
  open,
  onOpenChange,
  startsAt,
  onCreated,
  onWantFullForm,
}: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [duration, setDuration] = useState<string>("60");

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: rates } = await supabase
        .from("student_rates")
        .select("student_id, subject, price_per_lesson, archived_at")
        .eq("tutor_id", user.id)
        .eq("source", "independent");
      const active = (rates ?? []).filter((r: any) => !r.archived_at);
      const ids = Array.from(new Set(active.map((r: any) => r.student_id)));
      if (!ids.length) {
        setStudents([]);
        setLoading(false);
        return;
      }
      const [{ data: profs }, { data: defaults }] = await Promise.all([
        supabase.from("profiles").select("id, first_name, last_name").in("id", ids),
        supabase
          .from("tutor_student_defaults")
          .select("student_id, default_meeting_url")
          .eq("tutor_id", user.id)
          .in("student_id", ids),
      ]);
      const nameOf = new Map(
        (profs ?? []).map((p: any) => [
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень",
        ])
      );
      const meetOf = new Map(
        (defaults ?? []).map((d: any) => [d.student_id, d.default_meeting_url])
      );
      // Keep latest rate per student
      const byStudent = new Map<string, any>();
      active.forEach((r: any) => {
        if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, r);
      });
      const rows: StudentRow[] = Array.from(byStudent.values()).map((r: any) => ({
        student_id: r.student_id,
        subject: r.subject || "",
        price: Number(r.price_per_lesson ?? 0),
        name: nameOf.get(r.student_id) ?? "Учень",
        default_meeting_url: (meetOf.get(r.student_id) as string | null) ?? null,
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name, "uk"));
      if (cancelled) return;
      setStudents(rows);
      const last = localStorage.getItem(LAST_KEY);
      const initial =
        rows.find((r) => r.student_id === last)?.student_id ?? rows[0]?.student_id ?? "";
      setStudentId(initial);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  const selected = useMemo(
    () => students.find((s) => s.student_id === studentId) ?? null,
    [students, studentId]
  );

  const submit = async () => {
    if (!user || !startsAt || !selected) return;
    if (!selected.subject) {
      toast.error("У учня не вказаний предмет — відкрийте повну форму");
      return;
    }
    setSubmitting(true);
    const payload = {
      tutor_id: user.id,
      student_id: selected.student_id,
      subject: selected.subject,
      starts_at: startsAt.toISOString(),
      duration_minutes: parseInt(duration) || 60,
      status: "scheduled" as const,
      created_by: user.id,
      source: "independent",
      student_price: selected.price || 0,
      tutor_payout: 0,
      meeting_url: selected.default_meeting_url || null,
    };
    const { error } = await supabase.from("lessons").insert(payload);
    setSubmitting(false);
    if (error) {
      console.error(error);
      toast.error(error.message || "Не вдалося створити урок");
      return;
    }
    localStorage.setItem(LAST_KEY, selected.student_id);
    toast.success(
      `Урок створено · ${selected.name} · ${startsAt.toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    );
    onOpenChange(false);
    onCreated?.();
  };

  const timeLabel = startsAt
    ? startsAt.toLocaleString("uk-UA", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Швидкий урок</DialogTitle>
          <DialogDescription>{timeLabel}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : students.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Спершу додайте учня в розділі «Мої учні».
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Учень</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.student_id} value={s.student_id}>
                      {s.name} {s.subject ? `· ${s.subject}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Тривалість, хв</Label>
              <Input
                type="number"
                min={15}
                step={15}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            {selected && (
              <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                {selected.subject || "Без предмета"} · {selected.price || 0} ₴
                {selected.default_meeting_url ? " · Zoom/Meet ✓" : ""}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {startsAt && onWantFullForm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onWantFullForm(startsAt);
              }}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Деталі
            </Button>
          )}
          <Button onClick={submit} disabled={submitting || !selected}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Створити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
