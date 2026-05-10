import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubjectSelect } from "@/components/SubjectSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown, Loader2, UserPlus, CalendarPlus, BadgeDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

type TabKey = "student" | "lesson" | "payment";

interface OpenState {
  student: boolean;
  lesson: boolean;
  payment: boolean;
}

const STORAGE_KEY = "otutorhub_quick_actions";

interface StudentRow {
  student_id: string;
  name: string;
  subject: string;
  price: number;
  default_meeting_url?: string | null;
}

interface UnpaidLesson {
  id: string;
  starts_at: string;
  subject: string;
  student_id: string;
}

interface Props {
  onChanged?: () => void;
}

export function QuickActionsCard({ onChanged }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState<OpenState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { student: true, lesson: true, payment: true, ...JSON.parse(raw) };
    } catch {}
    return { student: true, lesson: true, payment: true };
  });

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lessonsCount, setLessonsCount] = useState(0);
  const [unpaid, setUnpaid] = useState<UnpaidLesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  }, [open]);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: rates }, { data: lc }] = await Promise.all([
      supabase
        .from("student_rates")
        .select("student_id, subject, price_per_lesson, archived_at")
        .eq("tutor_id", user.id),
      supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", user.id),
    ]);
    const active = (rates ?? []).filter((r: any) => !r.archived_at);
    const ids = Array.from(new Set(active.map((r: any) => r.student_id)));
    let rows: StudentRow[] = [];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      const nameOf = new Map(
        (profs ?? []).map((p: any) => [
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень",
        ])
      );
      const byStudent = new Map<string, any>();
      active.forEach((r: any) => {
        if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, r);
      });
      rows = Array.from(byStudent.values()).map((r: any) => ({
        student_id: r.student_id,
        name: nameOf.get(r.student_id) ?? "Учень",
        subject: r.subject || "",
        price: Number(r.price_per_lesson ?? 0),
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name, "uk"));
    }
    setStudents(rows);
    setLessonsCount((lc as any)?.count ?? (Array.isArray(lc) ? lc.length : 0) ?? 0);

    // unpaid lessons across all students for payment tab
    const { data: details } = await supabase
      .from("lesson_details")
      .select("lesson_id, lessons!inner(id, starts_at, subject, student_id, tutor_id, status)")
      .eq("lessons.tutor_id", user.id)
      .eq("student_payment_status", "unpaid")
      .neq("lessons.status", "cancelled")
      .neq("lessons.status", "pending")
      .limit(100);
    const u = ((details ?? []) as any[])
      .map((d) => ({
        id: d.lessons.id,
        starts_at: d.lessons.starts_at,
        subject: d.lessons.subject,
        student_id: d.lessons.student_id,
      }))
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1));
    setUnpaid(u);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const hasStudents = students.length > 0;
  const hasLessons = lessonsCount > 0;

  return (
    <Card className="p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-foreground">Швидкі дії</h2>
      </div>

      {!hasStudents && !loading && (
        <p className="mb-3 text-xs text-muted-foreground">
          Додайте першого учня щоб почати 👋
        </p>
      )}

      <div className="space-y-2">
        <ActionTab
          icon={<UserPlus className="h-4 w-4" />}
          title="Учень"
          highlight={!hasStudents}
          isOpen={open.student}
          onToggle={() => setOpen((o) => ({ ...o, student: !o.student }))}
        >
          <AddStudentForm onCreated={() => { refresh(); onChanged?.(); }} />
        </ActionTab>

        {hasStudents && (
          <ActionTab
            icon={<CalendarPlus className="h-4 w-4" />}
            title="Урок"
            highlight={hasStudents && !hasLessons}
            isOpen={open.lesson}
            onToggle={() => setOpen((o) => ({ ...o, lesson: !o.lesson }))}
          >
            <AddLessonForm students={students} onCreated={() => { refresh(); onChanged?.(); }} />
          </ActionTab>
        )}

        {hasStudents && hasLessons && (
          <ActionTab
            icon={<BadgeDollarSign className="h-4 w-4" />}
            title="Оплата"
            isOpen={open.payment}
            onToggle={() => setOpen((o) => ({ ...o, payment: !o.payment }))}
          >
            <AddPaymentForm
              students={students}
              unpaid={unpaid}
              onSaved={() => { refresh(); onChanged?.(); }}
            />
          </ActionTab>
        )}
      </div>
    </Card>
  );
}

function ActionTab({
  icon,
  title,
  highlight,
  isOpen,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  highlight?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background/50 transition-colors",
        highlight && "border-primary/40 bg-primary/5",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-primary">{icon}</span>
          <span>＋ {title}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && <div className="border-t border-border px-3 py-3">{children}</div>}
    </div>
  );
}

function AddStudentForm({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user) return;
    const fn = name.trim();
    if (!fn) return toast.error("Вкажіть ім'я учня");
    if (!subject) return toast.error("Виберіть предмет");
    const p = Number(price);
    if (isNaN(p) || p < 0) return toast.error("Введіть коректну ціну");

    setBusy(true);
    const newId = crypto.randomUUID();
    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: newId, first_name: fn, last_name: "", is_pending: true });
    if (profErr) {
      setBusy(false);
      return toast.error(profErr.message || "Не вдалося");
    }
    await supabase.from("user_roles").insert({ user_id: newId, role: "student" });
    const { error: rateErr } = await supabase.from("student_rates").insert({
      tutor_id: user.id,
      student_id: newId,
      subject,
      price_per_lesson: p,
      source: "independent",
    });
    setBusy(false);
    if (rateErr) {
      await supabase.from("user_roles").delete().eq("user_id", newId);
      await supabase.from("profiles").delete().eq("id", newId);
      return toast.error("Не вдалося зберегти");
    }
    toast.success(`${fn} додано 🎉`);
    setName("");
    setSubject("");
    setPrice("");
    onCreated();
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Ім'я</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Предмет</Label>
          <SubjectSelect value={subject} onValueChange={setSubject} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Ціна (₴)</Label>
          <Input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Додати
        </Button>
      </div>
    </div>
  );
}

function AddLessonForm({
  students,
  onCreated,
}: {
  students: StudentRow[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [studentId, setStudentId] = useState(students[0]?.student_id ?? "");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState("60");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!studentId && students[0]) setStudentId(students[0].student_id);
  }, [students, studentId]);

  const submit = async () => {
    if (!user) return;
    const s = students.find((x) => x.student_id === studentId);
    if (!s) return toast.error("Виберіть учня");
    if (!s.subject) return toast.error("У учня не вказаний предмет");
    setBusy(true);
    const startsAt = new Date(`${date}T${time}:00`);
    const { data: created, error } = await supabase
      .from("lessons")
      .insert({
        tutor_id: user.id,
        student_id: s.student_id,
        subject: s.subject,
        starts_at: startsAt.toISOString(),
        duration_minutes: Number(duration) || 60,
        status: "scheduled" as const,
        created_by: user.id,
        source: "independent",
      })
      .select("id")
      .single();
    if (!error && created) {
      await supabase
        .from("lesson_details")
        .upsert(
          { lesson_id: created.id, student_price: s.price || 0, tutor_payout: 0 } as any,
          { onConflict: "lesson_id" },
        );
    }
    setBusy(false);
    if (error) return toast.error(error.message || "Не вдалося");
    toast.success("Урок створено");
    onCreated();
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Учень</Label>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
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
          <Label className="text-xs">Тривалість, хв</Label>
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Дата</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Час</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Додати
        </Button>
      </div>
    </div>
  );
}

function AddPaymentForm({
  students,
  unpaid,
  onSaved,
}: {
  students: StudentRow[];
  unpaid: UnpaidLesson[];
  onSaved: () => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [busy, setBusy] = useState(false);

  const studentsWithUnpaid = useMemo(() => {
    const ids = new Set(unpaid.map((u) => u.student_id));
    return students.filter((s) => ids.has(s.student_id));
  }, [students, unpaid]);

  const lessonOptions = useMemo(
    () => unpaid.filter((u) => u.student_id === studentId),
    [unpaid, studentId],
  );

  useEffect(() => {
    if (!studentId && studentsWithUnpaid[0]) setStudentId(studentsWithUnpaid[0].student_id);
  }, [studentsWithUnpaid, studentId]);

  useEffect(() => {
    if (lessonOptions[0]) setLessonId(lessonOptions[0].id);
    else setLessonId("");
  }, [lessonOptions]);

  const submit = async () => {
    if (!lessonId) return toast.error("Виберіть урок");
    setBusy(true);
    const { error } = await supabase
      .from("lesson_details")
      .upsert(
        { lesson_id: lessonId, student_payment_status: "paid" } as any,
        { onConflict: "lesson_id" },
      );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Позначено як оплачено");
    onSaved();
  };

  if (studentsWithUnpaid.length === 0) {
    return <p className="text-xs text-muted-foreground">Немає неоплачених уроків 🎉</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Учень</Label>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {studentsWithUnpaid.map((s) => (
                <SelectItem key={s.student_id} value={s.student_id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Урок</Label>
          <Select value={lessonId} onValueChange={setLessonId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {lessonOptions.map((u) => {
                const d = new Date(u.starts_at);
                return (
                  <SelectItem key={u.id} value={u.id}>
                    {d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" })} · {u.subject}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy || !lessonId}>
          {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Зберегти
        </Button>
      </div>
    </div>
  );
}

export default QuickActionsCard;
