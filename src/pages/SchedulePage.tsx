import { AppLayout } from "@/components/AppLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
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
import { Clock, Plus, Loader2, Trash2, Copy, ChevronDown, ChevronUp, CheckCircle2, Circle, List, CalendarRange, HandHeart, Video, CalendarClock, CalendarDays } from "lucide-react";
import { TutorAvailabilityView } from "@/components/TutorAvailabilityView";
import { WeekCalendar } from "@/components/WeekCalendar";
import { QuickLessonDialog } from "@/components/QuickLessonDialog";
import { EmptyState } from "@/components/EmptyState";
import { SourceBadge, lessonSourceTint, type LessonSource } from "@/components/SourceBadge";
import { FindTutorDialog } from "@/components/FindTutorDialog";
import { StudentLessonActions } from "@/components/StudentLessonActions";
import { TutorChangeRequestsCard } from "@/components/TutorChangeRequestsCard";
import { AvailabilityManager } from "@/components/AvailabilityManager";
import { LessonCard } from "@/components/LessonCard";
import { formatPrice } from "@/lib/currency";
import { useSearchParams, Link } from "react-router-dom";
import { useAvailabilityRequestCount } from "@/hooks/useAvailabilityRequestCount";
import { cn } from "@/lib/utils";
import { MobileFilters } from "@/components/MobileFilters";
import { syncLessonToGoogleCalendar } from "@/lib/googleCalendarSync";

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
  meeting_url?: string | null;
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
  const { isIndependent } = useWorkspaceSettings();
  const isIndependentTutor = isTutor && !isManager && isIndependent;

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [tutors, setTutors] = useState<PersonOption[]>([]);
  const [students, setStudents] = useState<PersonOption[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [pairCurrency, setPairCurrency] = useState<Record<string, string>>({});
  const [view, setView] = useState<"list" | "week">("week");
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  // Student-only sub-tab in list view: upcoming (default) vs archive (past).
  const [studentArchive, setStudentArchive] = useState<"upcoming" | "past">("upcoming");

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
  const [quickSlot, setQuickSlot] = useState<Date | null>(null);
  const [form, setForm] = useState({
    tutor_id: "",
    student_id: "",
    subject: "",
    starts_at: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    duration_minutes: "60",
    notes: "",
    status: "scheduled" as LessonStatus,
    student_price: "",
    tutor_payout: "0",
    student_payment_status: "unpaid" as PaymentStatus,
    tutor_payout_status: "unpaid" as PaymentStatus,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{
    tutor_id?: boolean;
    student_id?: boolean;
    subject?: boolean;
    starts_at?: boolean;
  }>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState<string>("1"); // 1 = no repeat
  // Two-step form: step 1 = хто+коли, step 2 = деталі (оплата, тривалість, повторення).
  // Більшість користувачів зберігають одразу на кроці 1 з автозаповненими дефолтами.
  const [step, setStep] = useState<1 | 2>(1);

  // Edit dialog state (quick edit from calendar / list)
  const [editingLesson, setEditingLesson] = useState<(Lesson & { homework?: string | null; summary?: string | null }) | null>(null);
  const [editForm, setEditForm] = useState({
    subject: "",
    starts_at: "",
    duration_minutes: "60",
    homework: "",
    summary: "",
    meeting_url: "",
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Snapshot of original homework/summary so we can detect actual changes for notification
  const [editOriginal, setEditOriginal] = useState<{ homework: string; summary: string }>({
    homework: "",
    summary: "",
  });

  const openEdit = async (lesson: Lesson) => {
    // Re-fetch fresh fields: meeting_url from lessons, homework/summary from lesson_details
    const [{ data: lessonRow }, { data: detailsRow }] = await Promise.all([
      supabase.from("lessons").select("meeting_url").eq("id", lesson.id).maybeSingle(),
      supabase.from("lesson_details").select("homework, summary").eq("lesson_id", lesson.id).maybeSingle(),
    ]);
    const homework = detailsRow?.homework ?? "";
    const summary = detailsRow?.summary ?? "";
    const meeting_url = lessonRow?.meeting_url ?? (lesson as any).meeting_url ?? "";

    setEditingLesson({ ...lesson, homework, summary });
    setEditForm({
      subject: lesson.subject,
      starts_at: toLocalInputValue(lesson.starts_at),
      duration_minutes: String(lesson.duration_minutes),
      homework,
      summary,
      meeting_url,
    });
    setEditOriginal({ homework, summary });
  };

  // Permission helpers for the edit dialog
  const canEditScheduleFields = (lesson: Lesson | null) =>
    !!lesson && (isManager || (isTutor && lesson.tutor_id === user?.id));
  const canEditTeachingFields = (lesson: Lesson | null) =>
    !!lesson && (isManager || (isTutor && lesson.tutor_id === user?.id));

  const saveEdit = async () => {
    if (!editingLesson) return;
    setEditSubmitting(true);

    const lessonsPayload: any = {};
    const detailsPayload: any = {};
    if (canEditScheduleFields(editingLesson)) {
      lessonsPayload.subject = editForm.subject;
      lessonsPayload.starts_at = new Date(editForm.starts_at).toISOString();
      lessonsPayload.duration_minutes = parseInt(editForm.duration_minutes) || 60;
    }
    if (canEditTeachingFields(editingLesson)) {
      detailsPayload.homework = editForm.homework || null;
      detailsPayload.summary = editForm.summary || null;
      lessonsPayload.meeting_url = editForm.meeting_url || null;
    }

    if (Object.keys(lessonsPayload).length === 0 && Object.keys(detailsPayload).length === 0) {
      setEditSubmitting(false);
      setEditingLesson(null);
      return;
    }

    if (Object.keys(lessonsPayload).length > 0) {
      const { error } = await supabase
        .from("lessons")
        .update(lessonsPayload)
        .eq("id", editingLesson.id);
      if (error) {
        setEditSubmitting(false);
        console.error(error);
        toast.error("Не вдалося зберегти зміни");
        return;
      }
    }
    if (Object.keys(detailsPayload).length > 0) {
      const { error } = await supabase
        .from("lesson_details")
        .upsert({ lesson_id: editingLesson.id, ...detailsPayload }, { onConflict: "lesson_id" });
      if (error) {
        setEditSubmitting(false);
        console.error(error);
        toast.error("Не вдалося зберегти зміни");
        return;
      }
    }

    // Detect homework/summary changes and notify the student via Telegram
    const changed: Array<"homework" | "summary"> = [];
    if (canEditTeachingFields(editingLesson)) {
      if ((editForm.homework || "") !== (editOriginal.homework || "")) changed.push("homework");
      if ((editForm.summary || "") !== (editOriginal.summary || "")) changed.push("summary");
    }
    if (changed.length > 0) {
      // Fire-and-forget — failures shouldn't block the UI
      supabase.functions
        .invoke("notify-lesson-update", {
          body: { lessonId: editingLesson.id, changed },
        })
        .catch((e) => console.warn("notify-lesson-update failed", e));
    }

    setEditSubmitting(false);
    toast.success(
      changed.length > 0
        ? "Урок оновлено. Учень отримає сповіщення."
        : "Урок оновлено"
    );
    setEditingLesson(null);
    loadAll();
  };

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
    setStep(1);
    setCreateOpen(true);
  };

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);

    const [lessonsRes, profilesRes, rolesRes, tutorRes, ratesRes] = await Promise.all([
      supabase.from("lessons_visible").select("*").order("starts_at", { ascending: false }),
      supabase.from("profiles").select("id, first_name, last_name"),
      // RLS: non-managers only see their own row here. Used by managers/tutors for filters.
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("tutor_public_details").select("user_id, subjects"),
      // Used by students to discover their assigned tutors (RLS allows student to see own rates).
      supabase.from("student_rates").select("tutor_id, student_id, currency"),
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
    const rateRows = (ratesRes.data ?? []) as { tutor_id: string; student_id: string; currency?: string | null }[];
    const currencyByPair: Record<string, string> = {};
    rateRows.forEach((r) => {
      currencyByPair[`${r.tutor_id}:${r.student_id}`] = r.currency ?? "UAH";
    });
    setPairCurrency(currencyByPair);

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

    const rawLessons = (lessonsRes.data ?? []) as any[];
    console.log('[SchedulePage] lessons count:', rawLessons.length, 'unique ids:', new Set(rawLessons.map((l) => l.id)).size);
    const lessonsWithSource = rawLessons.map((l) => ({
      ...l,
      source: (l.source as LessonSource) ?? "hub",
    }));
    setLessons(Array.from(
      new Map(lessonsWithSource.map((l: any) => [l.id, l])).values()
    ) as Lesson[]);
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
  // Whether (tutor, student, subject) already has a saved rate.
  // Used by independent tutors so we know if we need to upsert student_rates after creating a lesson.
  const [existingRateForPair, setExistingRateForPair] = useState<boolean>(false);

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

  // Auto-fill prices for managers and independent tutors when tutor/student/subject change.
  // For independent tutors, tutor_payout is irrelevant (they pay themselves) — but student_price matters.
  useEffect(() => {
    if (!isManager && !isIndependentTutor) return;
    if (!form.tutor_id || !form.student_id || !form.subject) return;
    let cancelled = false;
    (async () => {
      setAutoFilling(true);
      const [exactRateRes, anyPairRateRes, payoutRes, fallbackRes] = await Promise.all([
        supabase
          .from("student_rates")
          .select("price_per_lesson")
          .eq("tutor_id", form.tutor_id)
          .eq("student_id", form.student_id)
          .eq("subject", form.subject)
          .maybeSingle(),
        // Fallback: any rate for this (tutor, student) pair (most recent).
        // NOTE: do not use .maybeSingle() here — pair may legitimately have several
        // subject rates and that would throw "multiple rows returned".
        supabase
          .from("student_rates")
          .select("price_per_lesson")
          .eq("tutor_id", form.tutor_id)
          .eq("student_id", form.student_id)
          .order("updated_at", { ascending: false })
          .limit(1),
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
      const anyPairRate = anyPairRateRes.data?.[0]?.price_per_lesson;
      // ВАЖЛИВО: student_price має братись ВИКЛЮЧНО зі student_rates (ціна для конкретного учня).
      // tutor_subject_rates / tutor_details — це СТАВКА ВИПЛАТИ репетитору, а не ціна для учня.
      // Раніше тут був фолбек на ставку репетитора — це робило student_price = tutor_payout, що ламало фінанси.
      const studentPrice =
        exactRateRes.data?.price_per_lesson ??
        anyPairRate;
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
      // Track whether this (student, subject) already has a saved rate.
      // For independent tutors we use this to decide whether we need to upsert
      // student_rates after creating the lesson.
      setExistingRateForPair(!!exactRateRes.data);
      setAutoFilling(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isManager, isIndependentTutor, form.tutor_id, form.student_id, form.subject]);

  // Pre-fill student_price from the most recent rate for this (tutor, student)
  // pair as soon as the student is picked — even before subject is chosen.
  // Prevents "0 ₴" lessons when tutor forgets to type the price.
  useEffect(() => {
    if (!isManager && !isIndependentTutor) return;
    if (!form.tutor_id || !form.student_id) return;
    if (form.student_price && form.student_price !== "0") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("student_rates")
        .select("price_per_lesson")
        .eq("tutor_id", form.tutor_id)
        .eq("student_id", form.student_id)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const price = data?.[0]?.price_per_lesson;
      if (price !== undefined && price !== null) {
        setForm((f) =>
          f.student_price && f.student_price !== "0"
            ? f
            : { ...f, student_price: String(price) }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isManager, isIndependentTutor, form.tutor_id, form.student_id]);

  // Smart prefill #1: якщо обрано тільки тутора, а в нього лише один учень — підставляємо.
  // І навпаки: якщо обрано тільки учня, а в нього лише один тутор — підставляємо.
  // Для менеджера джерело — student_rates (хто з ким працює).
  useEffect(() => {
    if (!createOpen) return;
    if (!isManager) return;
    let cancelled = false;
    (async () => {
      if (form.tutor_id && !form.student_id) {
        const { data } = await supabase
          .from("student_rates")
          .select("student_id")
          .eq("tutor_id", form.tutor_id);
        if (cancelled) return;
        const ids = Array.from(new Set((data ?? []).map((r: any) => r.student_id)));
        if (ids.length === 1) {
          setForm((f) => (f.student_id ? f : { ...f, student_id: ids[0] }));
        }
      } else if (!form.tutor_id && form.student_id) {
        const { data } = await supabase
          .from("student_rates")
          .select("tutor_id")
          .eq("student_id", form.student_id);
        if (cancelled) return;
        const ids = Array.from(new Set((data ?? []).map((r: any) => r.tutor_id)));
        if (ids.length === 1) {
          setForm((f) => (f.tutor_id ? f : { ...f, tutor_id: ids[0] }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen, isManager, form.tutor_id, form.student_id]);

  // Smart prefill #2: для тутора з одним учнем — авто-підстановка.
  useEffect(() => {
    if (!createOpen) return;
    if (isManager || !isTutor) return;
    if (form.student_id) return;
    if (students.length === 1) {
      setForm((f) => ({ ...f, student_id: students[0].id }));
    }
  }, [createOpen, isManager, isTutor, students, form.student_id]);

  // Smart prefill #3: успадковуємо тривалість з останнього уроку пари (tutor, student).
  useEffect(() => {
    if (!createOpen) return;
    if (!form.tutor_id || !form.student_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("lessons")
        .select("duration_minutes")
        .eq("tutor_id", form.tutor_id)
        .eq("student_id", form.student_id)
        .order("starts_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const d = data?.[0]?.duration_minutes;
      if (d && d > 0) {
        // Лише якщо користувач ще не змінював дефолт "60"
        setForm((f) => (f.duration_minutes && f.duration_minutes !== "60" ? f : { ...f, duration_minutes: String(d) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen, form.tutor_id, form.student_id]);

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
    const errors: {
      tutor_id?: boolean;
      student_id?: boolean;
      subject?: boolean;
      starts_at?: boolean;
    } = {};
    if (!form.tutor_id) errors.tutor_id = true;
    if (!form.student_id) errors.student_id = true;
    if (!form.subject || !form.subject.trim()) errors.subject = true;
    if (!form.starts_at) errors.starts_at = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.error("Заповніть усі обов'язкові поля");
      return;
    }
    setFormErrors({});
    setSubmitting(true);

    const status: LessonStatus = isStudent && !isManager && !isTutor ? "pending" : "scheduled";
    const baseStart = new Date(form.starts_at);

    // For independent tutors: if the form contains a price and we don't yet have
    // a saved student_rate for this exact (student, subject) pair, save it first.
    // The autofill_lesson_prices trigger will then pick it up automatically when
    // the lesson is inserted, and all future lessons for the same subject will
    // inherit the price as well.
    if (isIndependentTutor) {
      const priceFromForm = Number(form.student_price);
      if (!existingRateForPair && priceFromForm > 0) {
        const { error: rateErr } = await supabase
          .from("student_rates")
          .upsert(
            {
              tutor_id: user.id,
              student_id: form.student_id,
              subject: form.subject,
              price_per_lesson: priceFromForm,
              source: "independent",
            },
            { onConflict: "tutor_id,student_id,subject" }
          );
        if (rateErr) {
          // Not fatal: we'll still try to create the lesson, but warn the user.
          console.warn("Could not save subject rate", rateErr);
        } else {
          setExistingRateForPair(true);
        }
      }
    }

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
        source: isIndependentTutor ? "independent" : "hub",
      };
      if (isManager) {
        payload.student_price = Number(form.student_price) || 0;
        payload.tutor_payout = Number(form.tutor_payout) || 0;
        payload.student_payment_status = form.student_payment_status;
        payload.tutor_payout_status = form.tutor_payout_status;
      } else if (isIndependentTutor) {
        // Pass the price explicitly so even if the trigger fallback misses (e.g.
        // the rate upsert failed), the lesson still has the right price.
        const priceFromForm = Number(form.student_price);
        if (priceFromForm > 0) {
          payload.student_price = priceFromForm;
        }
      }
      payloads.push(payload);
    }

    const { data: insertedLessons, error } = await supabase
      .from("lessons")
      .insert(payloads)
      .select("id");
    setSubmitting(false);
    if (error) {
      console.error("Failed to create lesson", error);
      toast.error("Не вдалося створити урок. Спробуйте ще раз.");
      return;
    }
    (insertedLessons ?? []).forEach((l) => void syncLessonToGoogleCalendar(l.id, "upsert"));
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
      student_price: "",
      tutor_payout: "0",
      student_payment_status: "unpaid",
      tutor_payout_status: "unpaid",
      status: "scheduled",
    }));
    setRepeatWeeks("1");
    loadAll();
  };

  const updateStatus = async (lessonId: string, newStatus: LessonStatus) => {
    const prev = lessons;
    setLessons((curr) => curr.map((l) => (l.id === lessonId ? { ...l, status: newStatus } : l)));
    const { error } = await supabase.from("lessons").update({ status: newStatus }).eq("id", lessonId);
    if (error) {
      console.error("Failed to update lesson status", error);
      toast.error("Не вдалося оновити статус. Спробуйте ще раз.");
      setLessons(prev);
      return;
    }
    toast.success("Статус оновлено");
    void syncLessonToGoogleCalendar(lessonId, newStatus === "cancelled" ? "delete" : "upsert");
  };

  const updatePayment = async (
    lessonId: string,
    field: "student_payment_status" | "tutor_payout_status",
    value: PaymentStatus
  ) => {
    const prev = lessons;
    setLessons((curr) => curr.map((l) => (l.id === lessonId ? { ...l, [field]: value } : l)));
    const paidAtField = field === "student_payment_status" ? "student_paid_at" : "tutor_paid_at";
    const { error } = await supabase
      .from("lesson_details")
      .upsert(
        {
          lesson_id: lessonId,
          [field]: value,
          [paidAtField]: value === "paid" ? new Date().toISOString() : null,
        } as any,
        { onConflict: "lesson_id" },
      );
    if (error) {
      console.error("Failed to update payment status", error);
      toast.error("Не вдалося оновити оплату. Спробуйте ще раз.");
      setLessons(prev);
      return;
    }
    toast.success("Оплату оновлено");
  };

  const deleteLesson = async (lessonId: string) => {
    const prev = lessons;
    setLessons((curr) => curr.filter((l) => l.id !== lessonId));
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    if (error) {
      console.error("Failed to delete lesson", error);
      toast.error("Не вдалося видалити урок. Спробуйте ще раз.");
      setLessons(prev);
      return;
    }
    toast.success("Урок видалено");
    void syncLessonToGoogleCalendar(lessonId, "delete");
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

  // Pure student in list view: split into upcoming vs archive (past) and sort accordingly.
  // Upcoming → ascending (closest first). Past → descending (most recent first).
  const isPureStudentForList = isStudent && !isManager && !isTutor;
  const lessonsForList = useMemo(() => {
    if (!isPureStudentForList || view !== "list") return filteredLessons;
    const now = Date.now();
    const cutoff = now - 60 * 60 * 1000; // give a 1h grace period
    return filteredLessons.filter((l) => {
      const ts = new Date(l.starts_at).getTime();
      return studentArchive === "upcoming" ? ts >= cutoff : ts < cutoff;
    });
  }, [filteredLessons, isPureStudentForList, view, studentArchive]);

  // Group lessons into human buckets: Сьогодні / Завтра / Цей тиждень / Пізніше / Минулі.
  // Within each bucket, sort by time (upcoming asc, past desc).
  const grouped = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfterStart = new Date(todayStart); dayAfterStart.setDate(dayAfterStart.getDate() + 2);
    // End of current week (Sunday 23:59 — week starts Monday)
    const weekDay = (todayStart.getDay() + 6) % 7; // Mon=0
    const weekEnd = new Date(todayStart); weekEnd.setDate(todayStart.getDate() + (7 - weekDay)); // next Mon 00:00
    type Bucket = "today" | "tomorrow" | "thisWeek" | "later" | "past";
    const order: Bucket[] = ["today", "tomorrow", "thisWeek", "later", "past"];
    const labels: Record<Bucket, string> = {
      today: "Сьогодні",
      tomorrow: "Завтра",
      thisWeek: "Цей тиждень",
      later: "Пізніше",
      past: "Минулі",
    };
    const map = new Map<Bucket, Lesson[]>();
    order.forEach((k) => map.set(k, []));
    lessonsForList.forEach((l) => {
      const ts = new Date(l.starts_at);
      let key: Bucket;
      if (ts < todayStart) key = "past";
      else if (ts < tomorrowStart) key = "today";
      else if (ts < dayAfterStart) key = "tomorrow";
      else if (ts < weekEnd) key = "thisWeek";
      else key = "later";
      map.get(key)!.push(l);
    });
    const entries: Array<[string, Lesson[]]> = [];
    for (const k of order) {
      const items = map.get(k)!;
      if (items.length === 0) continue;
      items.sort((a, b) => {
        const ta = new Date(a.starts_at).getTime();
        const tb = new Date(b.starts_at).getTime();
        return k === "past" ? tb - ta : ta - tb;
      });
      entries.push([labels[k], items]);
    }
    return entries;
  }, [lessonsForList]);

  const filtersActive =
    filterStatus !== "all" ||
    filterTutor !== "all" ||
    filterStudent !== "all" ||
    filterSource !== "all" ||
    filterPeriod !== "all";

  // Show source filter only for managers (they may need to filter hub vs independent lessons across the school).
  // For an independent tutor "Всі / Самостійний" фільтр не має сенсу — він і так бачить лише свої уроки.
  const hasMixedSources = useMemo(() => {
    if (!isManager) return false;
    const sources = new Set(lessons.map((l) => l.source ?? "hub"));
    return sources.size > 1;
  }, [lessons, isManager]);

  // For students: list of distinct tutors they have lessons with
  const studentTutors = useMemo(() => {
    if (!isStudent || isManager || isTutor || !user) return [] as PersonOption[];
    const ids = Array.from(new Set(lessons.filter((l) => l.student_id === user.id).map((l) => l.tutor_id)));
    return ids.map((id) => ({ id, name: profilesMap[id] ?? "Репетитор" }));
  }, [lessons, isStudent, isManager, isTutor, user?.id, profilesMap]);

  const todayKey = new Date().toISOString().slice(0, 10);

  const isPureStudent = isStudent && !isManager && !isTutor;
  // Students cannot create or request lessons — only tutors and managers schedule them.
  const canCreate = isManager || isTutor;

  // Tabs: "lessons" (default) and "availability" — only for tutors/managers
  const showAvailabilityTab = isManager || isTutor;
  const availabilityBadge = useAvailabilityRequestCount();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "availability" && showAvailabilityTab ? "availability" : "lessons";
  const setTab = (t: "lessons" | "availability") => {
    const next = new URLSearchParams(searchParams);
    if (t === "lessons") next.delete("tab");
    else next.set("tab", t);
    setSearchParams(next, { replace: true });
  };

  return (
    <AppLayout>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl flex items-center gap-2">
            <span>📅</span>
            <span className="truncate">Розклад занять</span>
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {isManager
              ? "Усі уроки школи"
              : isTutor
              ? "Ваші уроки та робочий графік"
              : "Ваші уроки та запити"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MobileFilters
            compact
            align="right"
            desktopInline={false}
            activeCount={
              (filterStatus !== "all" ? 1 : 0) +
              (filterTutor !== "all" ? 1 : 0) +
              (filterStudent !== "all" ? 1 : 0) +
              (filterSource !== "all" ? 1 : 0) +
              (filterPeriod !== "all" ? 1 : 0)
            }
          >
            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
              <SelectTrigger className="h-9 w-full text-xs"><SelectValue placeholder="Статус" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі статуси</SelectItem>
                <SelectItem value="scheduled">Заплановано</SelectItem>
                <SelectItem value="completed">Проведено</SelectItem>
                <SelectItem value="cancelled">Скасовано</SelectItem>
              </SelectContent>
            </Select>
            {isManager && (
              <Select value={filterTutor} onValueChange={setFilterTutor}>
                <SelectTrigger className="h-9 w-full text-xs"><SelectValue placeholder="Репетитор" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всі репетитори</SelectItem>
                  {tutors.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {(isManager || isTutor) && (
              <Select value={filterStudent} onValueChange={setFilterStudent}>
                <SelectTrigger className="h-9 w-full text-xs"><SelectValue placeholder="Учень" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всі учні</SelectItem>
                  {students.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={filterPeriod} onValueChange={(v) => setFilterPeriod(v as any)}>
              <SelectTrigger className="h-9 w-full text-xs"><SelectValue placeholder="Період" /></SelectTrigger>
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
                <SelectTrigger className="h-9 w-full text-xs"><SelectValue placeholder="Джерело" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Усі</SelectItem>
                  <SelectItem value="hub">Хаб</SelectItem>
                  <SelectItem value="independent">Мої</SelectItem>
                </SelectContent>
              </Select>
            )}
            {filtersActive && (
              <Button size="sm" variant="ghost" className="h-9 w-full text-xs" onClick={() => {
                setFilterStatus("all"); setFilterTutor("all"); setFilterStudent("all"); setFilterSource("all"); setFilterPeriod("all");
              }}>Скинути фільтри</Button>
            )}
          </MobileFilters>
          <div className="hidden sm:inline-flex rounded-lg border border-border bg-card p-0.5">
            <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5" onClick={() => setView("list")}>
              <List className="h-3.5 w-3.5" />Список
            </Button>
            <Button variant={view === "week" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5" onClick={() => setView("week")}>
              <CalendarRange className="h-3.5 w-3.5" />Тиждень
            </Button>
          </div>
          {isPureStudent && studentTutors.length === 0 && (
            <FindTutorDialog
              trigger={
                <Button size="sm" className="h-9 gap-1.5">
                  <HandHeart className="h-4 w-4" />
                  <span className="hidden sm:inline">Запит на підбір</span>
                </Button>
              }
            />
          )}
          {canCreate && (
            <Dialog open={createOpen} onOpenChange={(open) => {
              setCreateOpen(open);
              if (!open) setFormErrors({}); else setStep(1);
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-9 gap-1.5 px-3">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Створити урок</span>
                  <span className="sm:hidden">Урок</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0">
                <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
                  <DialogTitle>Новий урок</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 px-6 py-2 overflow-y-auto flex-1">
                  <div>
                    <Label className={cn(formErrors.tutor_id && "text-destructive")}>
                      Репетитор <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={form.tutor_id}
                      onValueChange={(v) => {
                        setForm((f) => ({ ...f, tutor_id: v }));
                        if (formErrors.tutor_id) setFormErrors((e) => ({ ...e, tutor_id: false }));
                      }}
                      disabled={isTutor && !isManager}
                    >
                      <SelectTrigger
                        className={cn(
                          formErrors.tutor_id &&
                            "border-destructive ring-1 ring-destructive focus:ring-destructive"
                        )}
                      >
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
                  {formErrors.tutor_id && (
                    <p className="mt-1 text-xs text-destructive">Оберіть репетитора</p>
                  )}
                </div>
                <div>
                  <Label className={cn(formErrors.student_id && "text-destructive")}>
                    Учень <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.student_id}
                    onValueChange={(v) => {
                      setForm((f) => ({ ...f, student_id: v }));
                      if (formErrors.student_id) setFormErrors((e) => ({ ...e, student_id: false }));
                    }}
                    disabled={isStudent && !isManager && !isTutor}
                  >
                    <SelectTrigger
                      className={cn(
                        formErrors.student_id &&
                          "border-destructive ring-1 ring-destructive focus:ring-destructive"
                      )}
                    >
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
                  {formErrors.student_id && (
                    <p className="mt-1 text-xs text-destructive">Оберіть учня</p>
                  )}
                  {students.length === 0 && isTutor && !isManager && (
                    <div className="mt-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs">
                      <p className="text-muted-foreground mb-2">
                        {isIndependentTutor
                          ? "У вас ще немає учнів. Додайте першого учня — і зможете створити урок."
                          : "У вас ще немає прив'язаних учнів. Зверніться до менеджера, щоб призначити учня."}
                      </p>
                      {isIndependentTutor && (
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                          <Link to="/my-students" onClick={() => setCreateOpen(false)}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Додати учня
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="subject" className={cn(formErrors.subject && "text-destructive")}>
                    Предмет <span className="text-destructive">*</span>
                  </Label>
                  {subjectOptions.length > 0 ? (
                    <Select
                      value={form.subject}
                      onValueChange={(v) => {
                        setForm((f) => ({ ...f, subject: v }));
                        if (formErrors.subject) setFormErrors((e) => ({ ...e, subject: false }));
                      }}
                    >
                      <SelectTrigger
                        className={cn(
                          formErrors.subject &&
                            "border-destructive ring-1 ring-destructive focus:ring-destructive"
                        )}
                      >
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
                      onChange={(e) => {
                        setForm((f) => ({ ...f, subject: e.target.value }));
                        if (formErrors.subject && e.target.value.trim()) {
                          setFormErrors((er) => ({ ...er, subject: false }));
                        }
                      }}
                      placeholder="напр. Англійська"
                      className={cn(
                        formErrors.subject &&
                          "border-destructive ring-1 ring-destructive focus-visible:ring-destructive"
                      )}
                    />
                  )}
                  {formErrors.subject && (
                    <p className="mt-1 text-xs text-destructive">Вкажіть предмет</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="starts_at" className={cn(formErrors.starts_at && "text-destructive")}>
                      Дата і час <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="starts_at"
                      type="datetime-local"
                      value={form.starts_at}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, starts_at: e.target.value }));
                        if (formErrors.starts_at && e.target.value) {
                          setFormErrors((er) => ({ ...er, starts_at: false }));
                        }
                      }}
                      className={cn(
                        formErrors.starts_at &&
                          "border-destructive ring-1 ring-destructive focus-visible:ring-destructive"
                      )}
                    />
                    {formErrors.starts_at && (
                      <p className="mt-1 text-xs text-destructive">Вкажіть дату і час</p>
                    )}
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
                {isIndependentTutor && form.tutor_id && form.student_id && form.subject && (
                  <div>
                    <Label htmlFor="indep_student_price" className="flex items-center gap-1.5">
                      Ціна за урок (₴)
                      {autoFilling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </Label>
                    <Input
                      id="indep_student_price"
                      type="number"
                      min="0"
                      step="any"
                      value={form.student_price}
                      onChange={(e) => setForm((f) => ({ ...f, student_price: e.target.value }))}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {existingRateForPair
                        ? "💡 Ціна підтягнута з тарифу учня. Можна змінити для цього уроку."
                        : "🆕 Для цього предмета ще немає ціни — введіть її, і вона збережеться для майбутніх уроків."}
                    </p>
                  </div>
                )}
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
                    {form.tutor_id && form.student_id && form.subject && !autoFilling && (
                      <>
                        {(!form.student_price || form.student_price === "0") && (
                          <p className="text-xs text-warning -mt-2">
                            ⚠️ Для цього учня з обраного предмета ще не задано ціну. Введіть її вручну або задайте на сторінці «Люди» → «Учні репетитора».
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground -mt-2">
                          💡 Ціна учня береться з його тарифу, виплата — зі ставки репетитора. Можна змінити вручну.
                        </p>
                      </>
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
      </div>

      {/* Edit lesson dialog (opened from calendar / list) */}
      <Dialog open={!!editingLesson} onOpenChange={(open) => { if (!open) setEditingLesson(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border shrink-0">
            <DialogTitle>
              {canEditScheduleFields(editingLesson) || canEditTeachingFields(editingLesson)
                ? "Редагувати урок"
                : "Деталі уроку"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto px-6 py-4 flex-1 min-h-0">
            <div>
              <Label htmlFor="edit_subject">Предмет</Label>
              <Input id="edit_subject" value={editForm.subject}
                disabled={!canEditScheduleFields(editingLesson)}
                onChange={(e) => setEditForm((f) => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit_starts_at">Дата і час</Label>
                <Input id="edit_starts_at" type="datetime-local" value={editForm.starts_at}
                  disabled={!canEditScheduleFields(editingLesson)}
                  onChange={(e) => setEditForm((f) => ({ ...f, starts_at: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="edit_duration">Тривалість (хв)</Label>
                <Input id="edit_duration" type="number" min="15" step="15" value={editForm.duration_minutes}
                  disabled={!canEditScheduleFields(editingLesson)}
                  onChange={(e) => setEditForm((f) => ({ ...f, duration_minutes: e.target.value }))} />
              </div>
            </div>

            {/* Homework — primary teaching field */}
            <div>
              <Label htmlFor="edit_homework" className="flex items-center gap-1.5 font-medium">
                📝 Домашнє завдання
              </Label>
              <Textarea
                id="edit_homework"
                rows={4}
                value={editForm.homework}
                disabled={!canEditTeachingFields(editingLesson)}
                placeholder={canEditTeachingFields(editingLesson) ? "Що задано додому…" : "Не задано"}
                onChange={(e) => setEditForm((f) => ({ ...f, homework: e.target.value }))}
              />
            </div>

            {/* Summary — primary teaching field */}
            <div>
              <Label htmlFor="edit_summary" className="flex items-center gap-1.5 font-medium">
                📚 Конспект уроку
              </Label>
              <Textarea
                id="edit_summary"
                rows={5}
                value={editForm.summary}
                disabled={!canEditTeachingFields(editingLesson)}
                placeholder={canEditTeachingFields(editingLesson) ? "Що пройшли на уроці…" : "Конспект ще не додано"}
                onChange={(e) => setEditForm((f) => ({ ...f, summary: e.target.value }))}
              />
              {canEditTeachingFields(editingLesson) && (
                <p className="text-xs text-muted-foreground mt-1">
                  Учень отримає сповіщення про оновлення домашки чи конспекту.
                </p>
              )}
            </div>

            {/* Meeting link — collapsed at the bottom (rarely changed) */}
            <div>
              <Label htmlFor="edit_meeting_url" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Video className="h-3.5 w-3.5" /> Посилання на зустріч
              </Label>
              <Input id="edit_meeting_url" type="url" placeholder="https://meet.google.com/..."
                value={editForm.meeting_url}
                disabled={!canEditTeachingFields(editingLesson)}
                onChange={(e) => setEditForm((f) => ({ ...f, meeting_url: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="px-6 py-3 border-t border-border shrink-0 bg-card">
            <Button variant="outline" onClick={() => setEditingLesson(null)}>
              {canEditScheduleFields(editingLesson) || canEditTeachingFields(editingLesson) ? "Скасувати" : "Закрити"}
            </Button>
            {(canEditScheduleFields(editingLesson) || canEditTeachingFields(editingLesson)) && (
              <Button onClick={saveEdit} disabled={editSubmitting}>
                {editSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Зберегти
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showAvailabilityTab && (
        <div className="mb-5 inline-flex rounded-lg border border-border bg-card p-0.5">
          <Button
            variant={activeTab === "lessons" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setTab("lessons")}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Уроки
          </Button>
          <Button
            variant={activeTab === "availability" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5 relative"
            onClick={() => setTab("availability")}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Мої години
            {availabilityBadge > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
                {availabilityBadge}
              </span>
            )}
          </Button>
        </div>
      )}

      {/* Mobile-only view switcher */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5 sm:hidden">
        <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5" onClick={() => setView("list")}>
          <List className="h-3.5 w-3.5" />Список
        </Button>
        <Button variant={view === "week" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5" onClick={() => setView("week")}>
          <CalendarRange className="h-3.5 w-3.5" />Тиждень
        </Button>
      </div>

      {activeTab === "availability" ? (
        <AvailabilityManager />
      ) : (
      <>
      {studentTutors.length > 0 && (
        <div className="mb-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-foreground">Доступні години ваших репетиторів</h2>
          {studentTutors.map((t) => (
            <TutorAvailabilityView key={t.id} tutorId={t.id} tutorName={t.name} />
          ))}
        </div>
      )}

      {isTutor && !isManager && (
        <div className="mb-6">
          <TutorChangeRequestsCard nameOf={(id) => profilesMap[id] ?? "?"} />
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
            student_price: l.student_price,
            student_payment_status: l.student_payment_status,
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
            if (isIndependentTutor) {
              setQuickSlot(date);
              return;
            }
            setForm((f) => ({ ...f, starts_at: toLocalInputValue(date.toISOString()) }));
            setCreateOpen(true);
          }}
          onLessonClick={(l) => {
            const full = lessons.find((x) => x.id === l.id);
            if (full) openEdit(full);
          }}
          nameOf={(id) => profilesMap[id] ?? "?"}
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
        {isPureStudentForList && (
          <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5">
            <Button
              variant={studentArchive === "upcoming" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setStudentArchive("upcoming")}
            >
              <Clock className="h-3.5 w-3.5" />
              Майбутні
            </Button>
            <Button
              variant={studentArchive === "past" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setStudentArchive("past")}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Архів
            </Button>
          </div>
        )}
        {grouped.length === 0 ? (
        isPureStudent && studentTutors.length === 0 ? (
          <EmptyState
            icon={HandHeart}
            title="Поки немає репетитора"
            description="Залиште запит менеджеру oTutorHub — ми підберемо репетитора під ваші цілі, бюджет і графік. Як тільки призначимо — тут з'являться уроки."
          >
            <FindTutorDialog
              trigger={
                <Button>
                  <HandHeart className="h-4 w-4 mr-2" />
                  Запит на підбір репетитора
                </Button>
              }
            />
          </EmptyState>
        ) : (
          <EmptyState
            icon={Clock}
            title="Уроків ще немає"
            description={
              canCreate
                ? "Створіть перший урок — оберіть репетитора, учня та час."
                : "Як тільки репетитор або менеджер додасть урок, ви побачите його тут."
            }
            actionLabel={canCreate ? "Створити перший урок" : undefined}
            onAction={canCreate ? () => setCreateOpen(true) : undefined}
          />
        )
      ) : (
        <div className="space-y-6">
          {grouped.map(([bucketLabel, dayLessons]) => {
            const isToday = bucketLabel === "Сьогодні";
            return (
              <div key={bucketLabel}>
                <h3
                  className={`font-display text-sm font-semibold mb-3 ${
                    isToday ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {bucketLabel}
                  <span className="ml-2 text-xs font-normal opacity-70">· {dayLessons.length}</span>
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
                      <LessonCard
                        key={lesson.id}
                        lesson={{ ...lesson, currency: pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`] }}
                        variant="schedule"
                        studentName={studentName}
                        tutorName={tutorName}
                        showTutor={isManager || (isPureStudent && lesson.student_id === user?.id)}
                        meetingUrl={lesson.meeting_url}
                        chatPartnerId={
                          user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id
                        }
                        onTogglePayment={
                          (isManager || (isTutor && lesson.tutor_id === user?.id))
                            ? () =>
                                updatePayment(
                                  lesson.id,
                                  "student_payment_status",
                                  (lesson.student_payment_status === "paid" ? "unpaid" : "paid") as PaymentStatus,
                                )
                            : undefined
                        }
                        className={lessonSourceTint(lesson.source)}
                        onContentClick={
                          (isManager || (isTutor && lesson.tutor_id === user?.id))
                            ? () => openEdit(lesson)
                            : undefined
                        }
                        topRightActions={
                          <>

                            {canCopy && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                onClick={() => openCopy(lesson)}
                                title="Копіювати урок"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                    <Trash2 className="h-3.5 w-3.5" />
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
                          </>
                        }
                        extraActions={
                          <>
                            {(isManager || (isTutor && lesson.tutor_id === user?.id)) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11 gap-1.5 px-2 text-xs text-muted-foreground hover:text-primary"
                                onClick={() => openEdit(lesson)}
                                title="Перенести урок"
                              >
                                <CalendarClock className="h-4 w-4" />
                                <span className="hidden sm:inline">Перенести</span>
                              </Button>
                            )}
                            {canEditStatus ? (
                              <Select
                                value={lesson.status}
                                onValueChange={(v) => updateStatus(lesson.id, v as LessonStatus)}
                              >
                                <SelectTrigger className="h-11 w-[140px] text-xs">
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
                            ) : null}
                            {isPureStudent && lesson.student_id === user?.id && (
                              <StudentLessonActions
                                lessonId={lesson.id}
                                tutorId={lesson.tutor_id}
                                startsAt={lesson.starts_at}
                                status={lesson.status}
                              />
                            )}
                          </>
                        }
                        footer={
                          isManager ? (
                            <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2">
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="text-[11px] font-medium text-foreground whitespace-nowrap">
                                  🎓 {formatPrice(lesson.student_price, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.student_payment_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "student_payment_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.student_payment_status === 'paid' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                    <SelectItem value="paid">✓ Оплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                                <span className="text-[11px] font-medium text-foreground whitespace-nowrap">
                                  💼 {formatPrice(lesson.tutor_payout, pairCurrency[`${lesson.tutor_id}:${lesson.student_id}`])}
                                </span>
                                <Select
                                  value={lesson.tutor_payout_status}
                                  onValueChange={(v) => updatePayment(lesson.id, "tutor_payout_status", v as PaymentStatus)}
                                >
                                  <SelectTrigger className={`h-6 min-w-0 flex-1 border-0 px-2 text-[11px] font-medium ${lesson.tutor_payout_status === 'paid' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unpaid">⏳ Очікує</SelectItem>
                                    <SelectItem value="paid">✓ Виплачено</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          ) : null
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
      </>
      )}
      <QuickLessonDialog
        open={!!quickSlot}
        onOpenChange={(v) => !v && setQuickSlot(null)}
        startsAt={quickSlot}
        onCreated={() => loadAll()}
        onWantFullForm={(date) => {
          setForm((f) => ({ ...f, starts_at: toLocalInputValue(date.toISOString()) }));
          setCreateOpen(true);
        }}
      />
    </AppLayout>
  );
}
