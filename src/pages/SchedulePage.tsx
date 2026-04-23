import { AppLayout } from "@/components/AppLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Clock, Plus, Loader2, Trash2, Copy, ChevronDown, ChevronUp, CheckCircle2, Circle, List, CalendarRange, HandHeart } from "lucide-react";
import { TutorAvailabilityView } from "@/components/TutorAvailabilityView";
import { WeekCalendar } from "@/components/WeekCalendar";
import { EmptyState } from "@/components/EmptyState";
import { SourceBadge, lessonSourceTint, type LessonSource } from "@/components/SourceBadge";
import { FindTutorDialog } from "@/components/FindTutorDialog";

type LessonStatus = "pending" | "scheduled" | "completed" | "cancelled";
type PaymentStatus = "unpaid" | "paid";

interface Lesson {
  id: string;
  tutor_id: string;
  student_id: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  status: LessonStatus;
  notes: string | null;
  student_price: number;
  tutor_payout: number;
  student_payment_status: PaymentStatus;
  tutor_payout_status: PaymentStatus;
  source?: LessonSource;
}

interface PersonOption {
  id: string;
  name: string;
  subjects?: string[];
}

const statusLabel: Record<LessonStatus, string> = {
  pending: "Запит",
  scheduled: "Заплановано",
  completed: "Проведено",
  cancelled: "Скасовано",
};

const statusBadgeClass: Record<LessonStatus, string> = {
  pending: "bg-warning/10 text-warning border-0",
  scheduled: "bg-primary/10 text-primary border-0",
  completed: "bg-success/10 text-success border-0",
  cancelled: "bg-destructive/10 text-destructive border-0",
};

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateGroup(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "long" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

export default function SchedulePage() {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const isTutor = roles.includes("tutor");
  const isStudent = roles.includes("student");

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [tutors, setTutors] = useState<PersonOption[]>([]);
  const [students, setStudents] = useState<PersonOption[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [view, setView] = useState<"list" | "week">("list");
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());

  // Filters
  const [filterStatus, setFilterStatus] = useState<"all" | LessonStatus>("all");
  const [filterTutor, setFilterTutor] = useState<string>("all");
  const [filterStudent, setFilterStudent] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<"all" | LessonSource>("all");
  const [filterPeriod, setFilterPeriod] = useState<"all" | "upcoming" | "past" | "month" | "week">(
    "all"
  );

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    tutor_id: "",
    student_id: "",
    subject: "",
    starts_at: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    duration_minutes: "60",
    notes: "",
    status: "scheduled" as LessonStatus,
    student_price: "0",
    tutor_payout: "0",
    student_payment_status: "unpaid" as PaymentStatus,
    tutor_payout_status: "unpaid" as PaymentStatus,
  });
  const [submitting, setSubmitting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState<string>("1"); // 1 = no repeat

  const openCopy = (lesson: Lesson) => {
    // Pre-fill form with lesson data; default new starts_at = +7 days same time
    const next = new Date(lesson.starts_at);
    next.setDate(next.getDate() + 7);
    setForm({
      tutor_id: lesson.tutor_id,
      student_id: lesson.student_id,
      subject: lesson.subject,
      starts_at: toLocalInputValue(next.toISOString()),
      duration_minutes: String(lesson.duration_minutes),
      notes: lesson.notes ?? "",
      status: "scheduled",
      student_price: String(lesson.student_price ?? 0),
      tutor_payout: String(lesson.tutor_payout ?? 0),
      student_payment_status: "unpaid",
      tutor_payout_status: "unpaid",
    });
    setNotesOpen(Boolean(lesson.notes));
    setCreateOpen(true);
  };

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);

    const [lessonsRes, profilesRes, rolesRes, tutorRes, sourcesRes, ratesRes] = await Promise.all([
      supabase.from("lessons_visible").select("*").order("starts_at", { ascending: false }),
      supabase.from("profiles").select("id, first_name, last_name"),
      // RLS: non-managers only see their own row here. Used by managers/tutors for filters.
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("tutor_public_details").select("user_id, subjects"),
      supabase.from("lessons").select("id, source"),
      // Used by students to discover their assigned tutors (RLS allows student to see own rates).
      supabase.from("student_rates").select("tutor_id, student_id"),
    ]);

    const profiles = profilesRes.data ?? [];
    const pmap: Record<string, string> = {};
    profiles.forEach((p: any) => {
      pmap[p.id] = `${p.first_name} ${p.last_name}`.trim() || "Без імені";
    });
    setProfilesMap(pmap);

    const tutorSubjects: Record<string, string[]> = {};
    (tutorRes.data ?? []).forEach((t: any) => {
      tutorSubjects[t.user_id] = t.subjects ?? [];
    });

    const roleRows = rolesRes.data ?? [];
    const rateRows = (ratesRes.data ?? []) as { tutor_id: string; student_id: string }[];

    let tutorIds: string[] = [];
    let studentIds: string[] = [];

    if (isManager) {
      tutorIds = roleRows.filter((r: any) => r.role === "tutor").map((r: any) => r.user_id);
      studentIds = roleRows.filter((r: any) => r.role === "student").map((r: any) => r.user_id);
    } else if (isStudent && !isTutor) {
      // Student: tutors are those they have a rate with (or any past lesson tutor as fallback)
      const lessonTutors = ((lessonsRes.data ?? []) as any[])
        .filter((l) => l.student_id === user.id)
        .map((l) => l.tutor_id);
      tutorIds = Array.from(new Set([...rateRows.map((r) => r.tutor_id), ...lessonTutors]));
      studentIds = [user.id];
    } else if (isTutor && !isManager) {
      // Tutor: students are those they have a rate with (or any lesson student as fallback)
      const lessonStudents = ((lessonsRes.data ?? []) as any[])
        .filter((l) => l.tutor_id === user.id)
        .map((l) => l.student_id);
      studentIds = Array.from(new Set([...rateRows.map((r) => r.student_id), ...lessonStudents]));
      tutorIds = [user.id];
    }

    setTutors(
      tutorIds.map((id) => ({ id, name: pmap[id] ?? "Репетитор", subjects: tutorSubjects[id] ?? [] }))
    );
    setStudents(studentIds.map((id) => ({ id, name: pmap[id] ?? "Учень" })));

    const sourceMap: Record<string, LessonSource> = {};
    (sourcesRes.data ?? []).forEach((r: any) => {
      sourceMap[r.id] = (r.source as LessonSource) ?? "hub";
    });
    const lessonsWithSource = ((lessonsRes.data ?? []) as any[]).map((l) => ({
      ...l,
      source: sourceMap[l.id] ?? "hub",
    }));
    setLessons(lessonsWithSource as Lesson[]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, [user?.id]);

  // Pre-select for tutor/student
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      tutor_id: isTutor && !isManager ? user.id : f.tutor_id,
      student_id: isStudent && !isManager && !isTutor ? user.id : f.student_id,
    }));
  }, [user?.id, isManager, isTutor, isStudent]);

  const selectedTutor = tutors.find((t) => t.id === form.tutor_id);

  // Smart-form: subjects available for the selected tutor (from tutor profile + tutor_subject_rates)
  const [tutorRateSubjects, setTutorRateSubjects] = useState<string[]>([]);
  // Smart-form: subjects this student already has a rate for with this tutor
  const [pairSubjects, setPairSubjects] = useState<string[]>([]);
  const [autoFilling, setAutoFilling] = useState(false);

  // Load subjects from tutor_subject_rates whenever tutor changes
  useEffect(() => {
    if (!form.tutor_id) {
      setTutorRateSubjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tutor_subject_rates")
        .select("subject")
        .eq("tutor_id", form.tutor_id);
      if (!cancelled) {
        setTutorRateSubjects(((data ?? []) as { subject: string }[]).map((r) => r.subject));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.tutor_id]);

  // Load subjects with existing student_rates for the pair (for hinting)
  useEffect(() => {
    if (!form.tutor_id || !form.student_id) {
      setPairSubjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("student_rates")
        .select("subject")
        .eq("tutor_id", form.tutor_id)
        .eq("student_id", form.student_id);
      if (!cancelled) {
        setPairSubjects(((data ?? []) as { subject: string }[]).map((r) => r.subject));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.tutor_id, form.student_id]);

  // Combined subject options for dropdown (union of tutor profile + rate subjects + pair subjects)
  const subjectOptions = useMemo(() => {
    const set = new Set<string>();
    (selectedTutor?.subjects ?? []).forEach((s) => s && set.add(s));
    tutorRateSubjects.forEach((s) => s && set.add(s));
    pairSubjects.forEach((s) => s && set.add(s));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk"));
  }, [selectedTutor, tutorRateSubjects, pairSubjects]);

  // Auto-fill prices for managers when tutor/student/subject change
  useEffect(() => {
    if (!isManager) return;
    if (!form.tutor_id || !form.student_id || !form.subject) return;
    let cancelled = false;
    (async () => {
      setAutoFilling(true);
      const [rateRes, payoutRes, fallbackRes] = await Promise.all([
        supabase
          .from("student_rates")
          .select("price_per_lesson")
          .eq("tutor_id", form.tutor_id)
          .eq("student_id", form.student_id)
          .eq("subject", form.subject)
          .maybeSingle(),
        supabase
          .from("tutor_subject_rates")
          .select("rate_per_lesson")
          .eq("tutor_id", form.tutor_id)
          .eq("subject", form.subject)
          .maybeSingle(),
        supabase
          .from("tutor_details")
          .select("rate_per_lesson")
          .eq("user_id", form.tutor_id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const studentPrice = rateRes.data?.price_per_lesson;
      const tutorPayout =
        payoutRes.data?.rate_per_lesson ?? fallbackRes.data?.rate_per_lesson;
      setForm((f) => ({
        ...f,
        student_price:
          studentPrice !== undefined && studentPrice !== null
            ? String(studentPrice)
            : f.student_price,
        tutor_payout:
          tutorPayout !== undefined && tutorPayout !== null
            ? String(tutorPayout)
            : f.tutor_payout,
      }));
      setAutoFilling(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isManager, form.tutor_id, form.student_id, form.subject]);

  // Conflict detection: warn (not block) if tutor already has a lesson overlapping the proposed slot
  const conflictWarning = useMemo(() => {
    if (!form.tutor_id || !form.starts_at) return null;
    const startMs = new Date(form.starts_at).getTime();
    if (Number.isNaN(startMs)) return null;
    const dur = parseInt(form.duration_minutes) || 60;
    const endMs = startMs + dur * 60 * 1000;
    const conflict = lessons.find((l) => {
      if (l.tutor_id !== form.tutor_id) return false;
      if (l.status === "cancelled") return false;
      const ls = new Date(l.starts_at).getTime();
      const le = ls + (l.duration_minutes || 60) * 60 * 1000;
      return ls < endMs && le > startMs;
    });
    if (!conflict) return null;
    const t = new Date(conflict.starts_at).toLocaleString("uk-UA", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `У репетитора вже є урок (${conflict.subject}, ${t}). Можна продовжити, але час перетинається.`;
  }, [form.tutor_id, form.starts_at, form.duration_minutes, lessons]);

  const handleCreate = async () => {
    if (!user) return;
    if (!form.tutor_id || !form.student_id || !form.subject || !form.starts_at) {
      toast.error("Заповніть усі обов'язкові поля");
      return;
    }
    setSubmitting(true);

    const status: LessonStatus = isStudent && !isManager && !isTutor ? "pending" : "scheduled";
    const baseStart = new Date(form.starts_at);

    const repeats = Math.max(1, Math.min(52, parseInt(repeatWeeks) || 1));
    const payloads: any[] = [];
    for (let i = 0; i < repeats; i++) {
      const dt = new Date(baseStart);
      dt.setDate(dt.getDate() + i * 7);
      const payload: any = {
        tutor_id: form.tutor_id,
        student_id: form.student_id,
        subject: form.subject,
        starts_at: dt.toISOString(),
        duration_minutes: parseInt(form.duration_minutes) || 60,
        notes: form.notes || null,
        status: isManager ? form.status : status,
        created_by: user.id,
      };
      if (isManager) {
        payload.student_price = Number(form.student_price) || 0;
        payload.tutor_payout = Number(form.tutor_payout) || 0;
        payload.student_payment_status = form.student_payment_status;
        payload.tutor_payout_status = form.tutor_payout_status;
      }
      payloads.push(payload);
    }

    const { error } = await supabase.from("lessons").insert(payloads);
    setSubmitting(false);
    if (error) {
      console.error("Failed to create lesson", error);
      toast.error("Не вдалося створити урок. Спробуйте ще раз.");
      return;
    }
    toast.success(
      repeats > 1
        ? `Створено ${repeats} уроків`
        : status === "pending"
        ? "Запит створено"
        : "Урок створено"
    );
    setCreateOpen(false);
    setForm((f) => ({
      ...f,
      subject: "",
      notes: "",
      student_price: "0",
      tutor_payout: "0",
      student_payment_status: "unpaid",
      tutor_payout_status: "unpaid",
      status: "scheduled",
    }));
    setRepeatWeeks("1");
    loadAll();
  };

  const updateStatus = async (lessonId: string, newStatus: LessonStatus) => {
    const { error } = await supabase.from("lessons").update({ status: newStatus }).eq("id", lessonId);
    if (error) {
      console.error("Failed to update lesson status", error);
      toast.error("Не вдалося оновити статус. Спробуйте ще раз.");
      return;
    }
    toast.success("Статус оновлено");
    loadAll();
  };

  const updatePayment = async (
    lessonId: string,
    field: "student_payment_status" | "tutor_payout_status",
    value: PaymentStatus
  ) => {
    const update: any = { [field]: value };
    const { error } = await supabase.from("lessons").update(update).eq("id", lessonId);
    if (error) {
      console.error("Failed to update payment status", error);
      toast.error("Не вдалося оновити оплату. Спробуйте ще раз.");
      return;
    }
    toast.success("Оплату оновлено");
    loadAll();
  };

  const deleteLesson = async (lessonId: string) => {
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    if (error) {
      console.error("Failed to delete lesson", error);
      toast.error("Не вдалося видалити урок. Спробуйте ще раз.");
      return;
    }
    toast.success("Урок видалено");
    loadAll();
  };

  // Apply filters
  const filteredLessons = useMemo(() => {
    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    const day = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - day);
    weekStart.setHours(0, 0, 0, 0);

    return lessons.filter((l) => {
      if (filterStatus !== "all" && l.status !== filterStatus) return false;
      if (filterTutor !== "all" && l.tutor_id !== filterTutor) return false;
      if (filterStudent !== "all" && l.student_id !== filterStudent) return false;
      if (filterSource !== "all" && (l.source ?? "hub") !== filterSource) return false;
      const ts = new Date(l.starts_at).getTime();
      if (filterPeriod === "upcoming" && ts < now - 60 * 60 * 1000) return false;
      if (filterPeriod === "past" && ts >= now) return false;
      if (filterPeriod === "month" && ts < monthStart.getTime()) return false;
      if (filterPeriod === "week" && ts < weekStart.getTime()) return false;
      return true;
    });
  }, [lessons, filterStatus, filterTutor, filterStudent, filterSource, filterPeriod]);

  // Group filtered lessons by day
  const grouped = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    filteredLessons.forEach((l) => {
      const key = new Date(l.starts_at).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    });
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredLessons]);

  const filtersActive =
    filterStatus !== "all" ||
    filterTutor !== "all" ||
    filterStudent !== "all" ||
    filterSource !== "all" ||
    filterPeriod !== "all";

  // Show source filter only when tutor has both hub & independent lessons (or for managers)
  const hasMixedSources = useMemo(() => {
    const sources = new Set(lessons.map((l) => l.source ?? "hub"));
    return isManager || sources.size > 1;
  }, [lessons, isManager]);

  // For students: list of distinct tutors they have lessons with
  const studentTutors = useMemo(() => {
    if (!isStudent || isManager || isTutor || !user) return [] as PersonOption[];
    const ids = Array.from(new Set(lessons.filter((l) => l.student_id === user.id).map((l) => l.tutor_id)));
    return ids.map((id) => ({ id, name: profilesMap[id] ?? "Репетитор" }));
  }, [lessons, isStudent, isManager, isTutor, user?.id, profilesMap]);

  const todayKey = new Date().toISOString().slice(0, 10);

  const canCreate = isManager || isTutor || isStudent;

  return (
    <AppLayout>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Розклад занять</h1>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "Усі уроки школи"
              : isTutor
              ? "Ваші уроки"
              : "Ваші уроки та запити"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Статус" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всі статуси</SelectItem>
              <SelectItem value="pending">Запит</SelectItem>
              <SelectItem value="scheduled">Заплановано</SelectItem>
              <SelectItem value="completed">Проведено</SelectItem>
              <SelectItem value="cancelled">Скасовано</SelectItem>
            </SelectContent>
          </Select>
          {(isManager || isTutor) && (
            <Select value={filterTutor} onValueChange={setFilterTutor}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Репетитор" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі репетитори</SelectItem>
                {tutors.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {(isManager || isTutor) && (
            <Select value={filterStudent} onValueChange={setFilterStudent}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Учень" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі учні</SelectItem>
                {students.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={filterPeriod} onValueChange={(v) => setFilterPeriod(v as any)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Період" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Весь час</SelectItem>
              <SelectItem value="upcoming">Майбутні</SelectItem>
              <SelectItem value="past">Минулі</SelectItem>
              <SelectItem value="week">Цей тиждень</SelectItem>
              <SelectItem value="month">Цей місяць</SelectItem>
            </SelectContent>
          </Select>
          {hasMixedSources && (
            <Select value={filterSource} onValueChange={(v) => setFilterSource(v as any)}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Джерело" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Усі</SelectItem>
                <SelectItem value="hub">Хаб</SelectItem>
                <SelectItem value="independent">Мої</SelectItem>
              </SelectContent>
            </Select>
          )}
          {filtersActive && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => {
              setFilterStatus("all"); setFilterTutor("all"); setFilterStudent("all"); setFilterSource("all"); setFilterPeriod("all");
            }}>Скинути</Button>
          )}
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5" onClick={() => setView("list")}>
              <List className="h-3.5 w-3.5" />Список
            </Button>
            <Button variant={view === "week" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5" onClick={() => setView("week")}>
              <CalendarRange className="h-3.5 w-3.5" />Тиждень
            </Button>
          </div>
        </div>
        {canCreate && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {isStudent && !isManager && !isTutor ? "Запросити урок" : "Створити урок"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0">
              <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
                <DialogTitle>
                  {isStudent && !isManager && !isTutor ? "Запит на урок" : "Новий урок"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 px-6 py-2 overflow-y-auto flex-1">
                <div>
                  <Label>Репетитор</Label>
                  <Select
                    value={form.tutor_id}
                    onValueChange={(v) => setForm((f) => ({ ...f, tutor_id: v }))}
                    disabled={isTutor && !isManager}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Оберіть репетитора" />
                    </SelectTrigger>
                    <SelectContent>
                      {tutors.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Учень</Label>
                  <Select
                    value={form.student_id}
                    onValueChange={(v) => setForm((f) => ({ ...f, student_id: v }))}
                    disabled={isStudent && !isManager && !isTutor}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Оберіть учня" />
                    </SelectTrigger>
                    <SelectContent>
                      {students.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="subject">Предмет</Label>
                  {subjectOptions.length > 0 ? (
                    <Select
                      value={form.subject}
                      onValueChange={(v) => setForm((f) => ({ ...f, subject: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Оберіть предмет" />
                      </SelectTrigger>
                      <SelectContent>
                        {subjectOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                            {pairSubjects.includes(s) ? " ✓" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="subject"
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      placeholder="напр. Англійська"
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="starts_at">Дата і час</Label>
                    <Input
                      id="starts_at"
                      type="datetime-local"
                      value={form.starts_at}
                      onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="duration">Тривалість (хв)</Label>
                    <Input
                      id="duration"
                      type="number"
                      min="15"
                      step="15"
                      value={form.duration_minutes}
                      onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                    />
                  </div>
                </div>
                {isManager && (
                  <>
                    <div>
                      <Label>Статус уроку</Label>
                      <Select
                        value={form.status}
                        onValueChange={(v) => setForm((f) => ({ ...f, status: v as LessonStatus }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Оберіть статус" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Запит</SelectItem>
                          <SelectItem value="scheduled">Заплановано</SelectItem>
                          <SelectItem value="completed">Проведено</SelectItem>
                          <SelectItem value="cancelled">Скасовано</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="student_price" className="flex items-center gap-1.5">
                          Оплата учня (₴)
                          {autoFilling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        </Label>
                        <Input
                          id="student_price"
                          type="number"
                          min="0"
                          step="any"
                          value={form.student_price}
                          onChange={(e) => setForm((f) => ({ ...f, student_price: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="tutor_payout" className="flex items-center gap-1.5">
                          Виплата репетитору (₴)
                          {autoFilling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        </Label>
                        <Input
                          id="tutor_payout"
                          type="number"
                          min="0"
                          step="any"
                          value={form.tutor_payout}
                          onChange={(e) => setForm((f) => ({ ...f, tutor_payout: e.target.value }))}
                        />
                      </div>
                    </div>
                    {form.tutor_id && form.student_id && form.subject && (
                      <p className="text-xs text-muted-foreground -mt-2">
                        💡 Ціни автоматично підтягуються з тарифів пари. Можна змінити вручну.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Статус оплати учня</Label>
                        <Select
                          value={form.student_payment_status}
                          onValueChange={(v) => setForm((f) => ({ ...f, student_payment_status: v as PaymentStatus }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Оберіть статус" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unpaid">Очікує</SelectItem>
                            <SelectItem value="paid">Оплачено</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Статус виплати репетитору</Label>
                        <Select
                          value={form.tutor_payout_status}
                          onValueChange={(v) => setForm((f) => ({ ...f, tutor_payout_status: v as PaymentStatus }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Оберіть статус" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unpaid">Очікує</SelectItem>
                            <SelectItem value="paid">Оплачено</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}
                {isStudent && !isManager && !isTutor && (
                  <p className="text-xs text-muted-foreground">
                    Це буде запит. Менеджер або репетитор підтвердить його.
                  </p>
                )}
                {conflictWarning && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                    ⚠ {conflictWarning}
                  </div>
                )}
                {(isManager || isTutor) && (
                  <div>
                    <Label htmlFor="repeat">Повторювати щотижня</Label>
                    <Select value={repeatWeeks} onValueChange={setRepeatWeeks}>
                      <SelectTrigger id="repeat"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Не повторювати</SelectItem>
                        <SelectItem value="2">2 тижні</SelectItem>
                        <SelectItem value="4">4 тижні</SelectItem>
                        <SelectItem value="8">8 тижнів</SelectItem>
                        <SelectItem value="12">12 тижнів</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setNotesOpen((v) => !v)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    <span className="flex-1 text-left">
                      Нотатки {form.notes ? `(${form.notes.length})` : "(опц.)"}
                    </span>
                    {notesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {notesOpen && (
                    <Textarea
                      id="notes"
                      rows={3}
                      className="mt-2"
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="Додаткова інформація..."
                    />
                  )}
                </div>
              </div>
              <DialogFooter className="px-6 pb-6 pt-3 border-t border-border bg-background shrink-0">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Скасувати
                </Button>
                <Button onClick={handleCreate} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Зберегти
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {studentTutors.length > 0 && (
        <div className="mb-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-foreground">Доступні години ваших репетиторів</h2>
          {studentTutors.map((t) => (
            <TutorAvailabilityView key={t.id} tutorId={t.id} tutorName={t.name} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === "week" ? (
        <WeekCalendar
          weekStart={weekAnchor}
          lessons={filteredLessons.map((l) => ({
            id: l.id,
            starts_at: l.starts_at,
            duration_minutes: l.duration_minutes,
            subject: l.subject,
            status: l.status,
            tutor_id: l.tutor_id,
            student_id: l.student_id,
          }))}
          onPrev={() => {
            const d = new Date(weekAnchor);
            d.setDate(d.getDate() - 7);
            setWeekAnchor(d);
          }}
          onNext={() => {
            const d = new Date(weekAnchor);
            d.setDate(d.getDate() + 7);
            setWeekAnchor(d);
          }}
          onToday={() => setWeekAnchor(new Date())}
          onSlotClick={(date) => {
            if (!canCreate) return;
            setForm((f) => ({ ...f, starts_at: toLocalInputValue(date.toISOString()) }));
            setCreateOpen(true);
          }}
          nameOf={(id) => profilesMap[id] ?? "?"}
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Уроків ще немає"
          description={
            canCreate
              ? "Створіть перший урок — оберіть репетитора, учня та час."
              : "Як тільки урок з'явиться у розкладі, ви побачите його тут."
          }
          actionLabel={canCreate ? "Створити перший урок" : undefined}
          onAction={canCreate ? () => setCreateOpen(true) : undefined}
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([dayKey, dayLessons]) => {
            const isToday = dayKey === todayKey;
            return (
              <div key={dayKey}>
                <h3
                  className={`font-display text-sm font-semibold mb-3 ${
                    isToday ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {formatDateGroup(dayLessons[0].starts_at)}
                  {isToday && " (сьогодні)"}
                </h3>
                <div className="space-y-2">
                  {dayLessons.map((lesson) => {
                    const tutorName = profilesMap[lesson.tutor_id] ?? "?";
                    const studentName = profilesMap[lesson.student_id] ?? "?";
                    const canEditStatus =
                      isManager || (isTutor && lesson.tutor_id === user?.id);
                    const canDelete =
                      isManager ||
                      (isTutor &&
                        lesson.tutor_id === user?.id &&
                        (lesson.status === "pending" || lesson.status === "scheduled"));
                    const canCopy =
                      isManager || (isTutor && lesson.tutor_id === user?.id);

                    return (
                      <div
                        key={lesson.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
                          isToday ? "border-primary/20 bg-primary/5" : "border-border bg-card"
                        } ${lessonSourceTint(lesson.source)}`}
                      >
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Clock className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate flex items-center gap-2">
                              <span className="truncate">{lesson.subject} — {formatTime(lesson.starts_at)}</span>
                              {lesson.source && hasMixedSources && (
                                <SourceBadge source={lesson.source} showIcon={false} />
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {tutorName} → {studentName} · {lesson.duration_minutes} хв
                            </p>
                            {isManager && (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mt-1">
                                <span>Учень: {lesson.student_price} ₴</span>
                                <Select
                                  value={lesson.student_payment_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "student_payment_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 w-[110px] text-xs ${lesson.student_payment_status === 'paid' ? 'text-success border-success/30' : 'text-warning border-warning/30'}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">Очікує</SelectItem>
                                    <SelectItem value="paid">Оплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                                <span className="mx-1">·</span>
                                <span>Виплата: {lesson.tutor_payout} ₴</span>
                                <Select
                                  value={lesson.tutor_payout_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "tutor_payout_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 w-[110px] text-xs ${lesson.tutor_payout_status === 'paid' ? 'text-success border-success/30' : 'text-warning border-warning/30'}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">Очікує</SelectItem>
                                    <SelectItem value="paid">Виплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {canEditStatus ? (
                            <Select
                              value={lesson.status}
                              onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                            >
                              <SelectTrigger className="h-8 w-[140px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(isManager
                                  ? (["pending", "scheduled", "completed", "cancelled"] as LessonStatus[])
                                  : (["scheduled", "completed", "cancelled"] as LessonStatus[])
                                ).map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {statusLabel[s]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={statusBadgeClass[lesson.status]}>
                              {statusLabel[lesson.status]}
                            </Badge>
                          )}
                          {canCopy && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={() => openCopy(lesson)}
                              title="Копіювати урок"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Видалити урок?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Цю дію не можна скасувати.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Скасувати</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteLesson(lesson.id)}>
                                    Видалити
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
