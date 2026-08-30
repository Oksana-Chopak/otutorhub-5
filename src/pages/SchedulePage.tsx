import { AppLayout } from "@/components/AppLayout";
import { bumpDataVersion, useDataVersion } from "@/lib/dataBus";
import { logEvent } from "@/lib/analytics";
import { pairNextDefault } from "@/lib/nextLessonDefault";
import { maybeAutoStartFireflies } from "@/lib/aiNotes";
import { setLessonStatus } from "@/lib/lessonActions";
import { useLessonStatus } from "@/hooks/useLessonStatus";
import { DateTimeField } from "@/components/DateTimeField";
import { getLocale } from "@/lib/locale";
import { PageFAB } from "@/components/PageFAB";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafe, updateLessonDetailsSafeBulk } from "@/lib/lessonDetailsSafe";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { ScheduleSkeleton } from "@/components/PageSkeletons";
import { lessonToasts } from "@/lib/toasts";
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
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Clock, Plus, Loader2, ChevronDown, ChevronUp, Circle, List, CalendarRange, HandHeart, Video, CalendarDays , Menu } from "lucide-react";
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
import { LessonDetailsDialog } from "@/components/LessonDetailsDialog";
import { SubjectComboBox } from "@/components/SubjectComboBox";
import { formatPrice } from "@/lib/currency";
import { useSearchParams, Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ScheduleFiltersSheet } from "@/components/ScheduleFiltersSheet";
import { useScheduleFilters } from "@/hooks/useScheduleFilters";
import { syncLessonToGoogleCalendar } from "@/lib/googleCalendarSync";
import { insertNotification } from "@/lib/notifications";
import { notifyGroupLessonCancelled } from "@/lib/groupLessons";

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

// statusLabel is computed inside the component using t() — see statusLabelFn below

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
  return d.toLocaleDateString(getLocale(), { weekday: "short", day: "numeric", month: "long" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
}

function SegSwitch<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex shrink-0 rounded-[12px] p-1" style={{ background: "rgba(15,15,26,.06)" }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="flex h-9 items-center gap-1.5 rounded-[9px] px-2.5 sm:px-3 text-[15px] transition-all"
          style={
            value === o.value
              ? { background: "#fff", color: "#1f8e7e", fontWeight: 700, boxShadow: "0 2px 8px -2px rgba(15,15,26,.18)", fontFamily: "Inter, system-ui, sans-serif" }
              : { color: "var(--sub,#6b7088)", fontWeight: 600, fontFamily: "Inter, system-ui, sans-serif" }
          }
        >
          {o.icon}
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function SchedulePage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
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
  const [view, setView] = useState<"list" | "week">(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches ? "week" : "list"
  );
  // Глибокі лінки з дашборда: показати в списку лише проблемні уроки
  const [listFocus, setListFocus] = useState<null | "unpriced" | "nolink">(null);
  // Per-pair default meeting URLs: the dashboard "lessons without a link" count treats
  // a configured pair default as "has a link" — the nolink filter must agree, or the
  // badge count and the list it opens diverge.
  const [defaultMeetingUrls, setDefaultMeetingUrls] = useState<Record<string, string>>({});
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  // Student-only sub-tab in list view: upcoming (default) vs archive (past).
  const [studentArchive, setStudentArchive] = useState<"upcoming" | "past">("upcoming");
  const [pastLimit, setPastLimit] = useState(8);

  // Filters — centralized in a hook so desktop + mobile share state/logic.
  const filters = useScheduleFilters();

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
    meeting_url: "",
    status: "scheduled" as LessonStatus,
    student_price: "",
    tutor_payout: "0",
    student_payment_status: "unpaid" as PaymentStatus,
    tutor_payout_status: "unpaid" as PaymentStatus,
  });
  const formTimeTouchedRef = useRef(false); // B18
  useEffect(() => { if (!createOpen) formTimeTouchedRef.current = false; }, [createOpen]);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{
    tutor_id?: boolean;
    student_id?: boolean;
    subject?: boolean;
    starts_at?: boolean;
  }>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState<string>("1"); // 1 = no repeat

  // Edit dialog state (quick edit from calendar / list)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [detailsLessonId, setDetailsLessonId] = useState<string | null>(null);
  // Snapshot of original homework/summary so we can detect actual changes for notification
  const [editOriginal, setEditOriginal] = useState<{ homework: string; summary: string }>({
    homework: "",
    summary: "",
  });

  const canEditScheduleFields = (lesson: Lesson | null) =>
    !!lesson && (isManager || (isTutor && lesson.tutor_id === user?.id && lesson.source === "independent"));
  const canEditTeachingFields = (lesson: Lesson | null) =>
    !!lesson && (isManager || (isTutor && lesson.tutor_id === user?.id));

  const openCopy = (lesson: Lesson) => {
    // Pre-fill form with lesson data; default new starts_at = +7 days same time
    const next = new Date(lesson.starts_at);
    next.setDate(next.getDate() + 7);
    setForm({
      tutor_id: lesson.tutor_id,
      student_id: lesson.student_id,
      subject: lesson.subject,
      starts_at: toLocalInputValue(next.toISOString()),
      // «Копіювати» ставить час свідомо — не перебивати розумним дефолтом.

      duration_minutes: String(lesson.duration_minutes),
      notes: lesson.notes ?? "",
      meeting_url: lesson.meeting_url ?? defaultMeetingUrls[`${lesson.tutor_id}:${lesson.student_id}`] ?? "",
      status: "scheduled",
      student_price: String(lesson.student_price ?? 0),
      tutor_payout: String(lesson.tutor_payout ?? 0),
      student_payment_status: "unpaid",
      tutor_payout_status: "unpaid",
    });
    formTimeTouchedRef.current = true;
    setNotesOpen(Boolean(lesson.notes));
    setCreateOpen(true);
  };

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);

    const [lessonsRes, profilesRes, rolesRes, tutorRes, ratesRes, defaultsRes] = await Promise.all([
      supabase
        .from("lessons_visible")
        .select("id, starts_at, duration_minutes, status, subject, tutor_id, student_id, meeting_url, source, notes, student_price, tutor_payout, student_payment_status, tutor_payout_status")
        .gte("starts_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())  // last 90 days
        .lte("starts_at", new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString())  // next 60 days
        .order("starts_at", { ascending: false })
        .limit(300),
      supabase.from("profiles").select("id, first_name, last_name").limit(300),
      // RLS: non-managers only see their own row here. Used by managers/tutors for filters.
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("tutor_public_details").select("user_id, subjects"),
      // Used by students to discover their assigned tutors (RLS allows student to see own rates).
      supabase.from("student_rates").select("tutor_id, student_id, currency"),
      supabase.from("tutor_student_defaults").select("tutor_id, student_id, default_meeting_url"),
    ]);

    // Surface load failures instead of silently showing an empty schedule.
    if (lessonsRes.error) {
      toast.error(t("schedule.loadFailed"));
    }

    const profiles = profilesRes.data ?? [];
    const pmap: Record<string, string> = {};
    profiles.forEach((p: any) => {
      pmap[p.id] = `${p.first_name} ${p.last_name}`.trim() || t('common.noName');
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

    const defaultsMap: Record<string, string> = {};
    ((defaultsRes.data ?? []) as any[]).forEach((d) => {
      if (d.default_meeting_url && d.default_meeting_url.trim()) {
        defaultsMap[`${d.tutor_id}:${d.student_id}`] = d.default_meeting_url.trim();
      }
    });
    setDefaultMeetingUrls(defaultsMap);

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
      tutorIds.map((id) => ({ id, name: pmap[id] ?? t('roles.tutor'), subjects: tutorSubjects[id] ?? [] }))
    );
    setStudents(studentIds.map((id) => ({ id, name: pmap[id] ?? t('roles.student') })));

    const rawLessons = (lessonsRes.data ?? []) as any[];
    const lessonsWithSource = rawLessons
      .filter((l) => {
        // Manager should never see independent tutor lessons
        if (isManager && l.source === "independent") return false;
        return true;
      })
      .map((l) => ({
        ...l,
        source: (l.source as LessonSource) ?? "hub",
      }));
    setLessons(Array.from(
      new Map(lessonsWithSource.map((l: any) => [l.id, l])).values()
    ) as Lesson[]);
    setLoading(false);
  };

  const dataVersion = useDataVersion(); // C3
  useEffect(() => {
    loadAll();
  }, [user?.id, dataVersion]);

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
    // ci/trim-дедуплікація: "english", " English " і "ENGLISH" — один пункт.
    // Пріоритет написання: ставки пари > предметні ставки репетитора > профіль.
    const byKey = new Map<string, string>();
    const add = (raw: string | null | undefined) => {
      const v = (raw ?? "").trim();
      if (!v) return;
      const k = v.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, v);
    };
    pairSubjects.forEach(add);
    tutorRateSubjects.forEach(add);
    (selectedTutor?.subjects ?? []).forEach(add);
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, "uk"));
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
    const conflictTime = new Date(conflict.starts_at).toLocaleString(getLocale(), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return t('schedule.conflictWarning', { subject: conflict.subject, time: conflictTime });
  }, [form.tutor_id, form.starts_at, form.duration_minutes, lessons]);

  const handleCreate = async () => {
    if (!user) return;

    if (isIndependentTutor && students.length === 0) {
      toast.error(t("schedule.addStudentFirst"));
      return;
    }

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
      if (errors.student_id && !form.student_id) {
        toast.error(t("schedule.selectStudent"));
      } else {
        toast.error(t('common.fillRequired'));
      }
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
        meeting_url: form.meeting_url.trim()
          ? form.meeting_url.trim()
          : (defaultMeetingUrls[`${form.tutor_id}:${form.student_id}`] ?? null),
        status: isManager ? form.status : status,
        created_by: user.id,
        source: isIndependentTutor ? "independent" : "hub",
      };
      // Financial fields (student_price / tutor_payout / *_status) live in
      // lesson_details, NOT on `lessons` — those columns were dropped. Sending them in
      // the lessons insert made the whole create fail ("column does not exist"). They
      // are written to lesson_details via detailRows right after the insert below.
      payloads.push(payload);
    }

    const { data: insertedLessons, error } = await supabase
      .from("lessons")
      .insert(payloads)
      .select("id, starts_at, student_id");
    setSubmitting(false);
    if (error) {
      console.error("Failed to create lesson", error);
      if (isIndependentTutor && students.length === 0) {
        toast.error(t("schedule.addStudentFirst"));
      } else {
        toast.error(t('schedule.createFailed') + (error?.message ? `: ${error.message}` : ""));
      }
      return;
    }
    // КОРІНЬ «ціна=0»: фінанси мають жити в lesson_details (звідти читає view),
    // а не лише в legacy-колонках lessons. Тригер ensure створює details з 0 —
    // одразу перезаписуємо явними значеннями з форми.
    const detailRows = (insertedLessons ?? []).map((l) => {
      const d: any = { lesson_id: l.id };
      if (isManager) {
        d.student_price = Number(form.student_price) || 0;
        d.tutor_payout = Number(form.tutor_payout) || 0;
        d.student_payment_status = form.student_payment_status;
        d.tutor_payout_status = form.tutor_payout_status;
      } else if (isIndependentTutor) {
        const priceFromForm = Number(form.student_price);
        if (priceFromForm > 0) d.student_price = priceFromForm;
      }
      return d;
    }).filter((d) => Object.keys(d).length > 1);
    if (detailRows.length > 0) {
      // ALL lesson_details writes go through the safe RPC. It applies the manager-only
      // payout columns (tutor_payout, tutor_payout_status) server-side ONLY when the
      // caller is a manager — so this single path is correct for both manager and tutor,
      // and never hits the "permission denied for column tutor_payout*" GRANT lock that a
      // direct upsert did.
      const results = await Promise.all(
        detailRows.map(({ lesson_id, ...patch }) => updateLessonDetailsSafe(lesson_id, patch as any)),
      );
      const detErr = results.find((r) => r.error)?.error;
      if (detErr) console.warn("lesson_details write after create failed", detErr);
    }
    (insertedLessons ?? []).forEach((l) => void syncLessonToGoogleCalendar(l.id, "upsert"));
    // Notify the individual student (mirrors QuickLessonDialog) — the canonical
    // Schedule create path was the only one scheduling lessons silently.
    const firstCreated = (insertedLessons ?? [])[0] as any;
    if (firstCreated?.student_id) {
      const dateStr = new Date(firstCreated.starts_at).toLocaleString(getLocale(), {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      });
      insertNotification({
        userId: firstCreated.student_id,
        type: `lesson_scheduled_${firstCreated.id}`,
        title: t("quickLessonDialog.notifLessonScheduledTitle"),
        body: repeats > 1
          ? t("quickLessonDialog.notifLessonSeriesBody", { count: repeats, date: dateStr })
          : t("quickLessonDialog.notifLessonScheduledBody", { date: dateStr }),
        link: "/schedule",
      });
    }
    toast.success(
      repeats > 1
        ? t('schedule.lessonsCreated', { count: repeats })
        : status === "pending"
        ? t('schedule.requestCreated')
        : t('schedule.lessonCreated')
    );
    setCreateOpen(false);
    bumpDataVersion(); // C3
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

  const { complete: flowComplete, cancel: flowCancel } = useLessonStatus();
  const updateStatus = async (lessonId: string, newStatus: LessonStatus) => {
    const prev = lessons;
    setLessons((curr) => curr.map((l) => (l.id === lessonId ? { ...l, status: newStatus } : l)));
    const lsn = prev.find((l) => l.id === lessonId);
    let ok = true;
    if (newStatus === "completed" && lsn) {
      const canMarkPay = lsn.student_payment_status !== "paid" &&
        (isManager || (isTutor && lsn.tutor_id === user?.id && lsn.source === "independent"));
      ok = await flowComplete(lsn as any, {
        canMarkPay,
        onMarkPaid: () => updatePayment(lessonId, "student_payment_status", "paid" as PaymentStatus),
      });
    } else if (newStatus === "cancelled" && lsn) {
      ok = await flowCancel(lsn as any);
    } else {
      const { error } = await setLessonStatus(lessonId, newStatus as import("@/lib/lessonActions").LessonStatus);
      if (error) { toast.error(t('schedule.statusUpdateFailed')); ok = false; }
      else toast.success(t('schedule.statusUpdated'));
    }
    if (!ok) { setLessons(prev); return; }
  };

  const updatePayment = async (
    lessonId: string,
    field: "student_payment_status" | "tutor_payout_status",
    value: PaymentStatus
  ) => {
    // Group lessons have no shared lesson_details row — per-participant payments are
    // marked in the lesson dialog (lesson_participants). Never write a bogus shared row.
    if (!lessons.find((l) => l.id === lessonId)?.student_id) return;
    const prev = lessons;
    setLessons((curr) => curr.map((l) => (l.id === lessonId ? { ...l, [field]: value } : l)));
    // tutor_payout_status / tutor_paid_at are column-locked (only the SECURITY DEFINER
    // RPC set_lesson_tutor_payout_status may write them) — a direct upsert from a manager
    // key hits "permission denied for column". Route each field to its correct writer,
    // exactly like FinancesPage.togglePayment does.
    const { error } =
      field === "student_payment_status"
        ? await updateLessonDetailsSafe(lessonId, {
            student_payment_status: value,
            student_paid_at: value === "paid" ? new Date().toISOString() : null,
          })
        : await supabase.rpc("set_lesson_tutor_payout_status", { _lesson_id: lessonId, _status: value });
    if (error) {
      console.error("Failed to update payment status", error);
      toast.error(t('schedule.paymentUpdateFailed'));
      setLessons(prev);
      return;
    }
    toast.success(t('schedule.paymentUpdated'));
  };

  const deleteLesson = async (lessonId: string) => {
    const prev = lessons;
    // Group lesson: notify participants BEFORE delete (their rows cascade away).
    const lsn = prev.find((l) => l.id === lessonId);
    if (lsn && !lsn.student_id) {
      await notifyGroupLessonCancelled(lessonId, lsn.subject);
    } else if (lsn?.student_id) {
      // Deleting an individual lesson silently vanished it from the student's
      // schedule — tell them, same copy as a cancellation.
      insertNotification({
        userId: lsn.student_id,
        type: `lesson_cancelled_${lessonId}`,
        title: t("notifications.lessonCancelledTitle", { subject: lsn.subject }),
        link: "/student/schedule",
      });
    }
    setLessons((curr) => curr.filter((l) => l.id !== lessonId));
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    if (error) {
      console.error("Failed to delete lesson", error);
      toast.error(t('schedule.deleteFailed'));
      setLessons(prev);
      return;
    }
    toast.success(t('schedule.lessonDeleted'));
    void syncLessonToGoogleCalendar(lessonId, "delete");
  };

  // Apply filters via the centralized hook (shared by desktop + mobile UI).
  const filteredLessons = useMemo(() => filters.apply(lessons), [lessons, filters.apply]);

  // Pure student in list view: split into upcoming vs archive (past) and sort accordingly.
  // Upcoming → ascending (closest first). Past → descending (most recent first).
  const isPureStudentForList = isStudent && !isManager && !isTutor;
  const lessonsForList = useMemo(() => {
    const base =
      listFocus === "unpriced"
        ? filteredLessons.filter((l) => l.status !== "cancelled" && (l.student_price == null || Number(l.student_price) === 0))
        : listFocus === "nolink"
        ? filteredLessons.filter(
            (l) =>
              l.status !== "cancelled" &&
              !l.meeting_url &&
              !defaultMeetingUrls[`${l.tutor_id}:${l.student_id}`]
          )
        : filteredLessons;
    if (!isPureStudentForList || view !== "list") return base;
    const now = Date.now();
    const cutoff = now - 60 * 60 * 1000; // give a 1h grace period
    return base.filter((l) => {
      const ts = new Date(l.starts_at).getTime();
      return studentArchive === "upcoming" ? ts >= cutoff : ts < cutoff;
    });
  }, [filteredLessons, isPureStudentForList, view, studentArchive, listFocus]);

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
      today: t('common.today'),
      tomorrow: t('common.tomorrow'),
      thisWeek: t('schedule.bucketThisWeek'),
      later: t('schedule.bucketLater'),
      past: t('schedule.bucketPast'),
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

  const filtersActive = filters.isActive;

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
    return ids.map((id) => ({ id, name: profilesMap[id] ?? t('roles.tutor') }));
  }, [lessons, isStudent, isManager, isTutor, user?.id, profilesMap]);

  const todayKey = new Date().toISOString().slice(0, 10);

  const isPureStudent = isStudent && !isManager && !isTutor;
  // Students cannot create or request lessons — only tutors and managers schedule them.
  const canCreate = isManager || isTutor;

  // Tabs: "lessons" (default) and "availability" — only for tutors/managers
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "list" || v === "week") setView(v);
    const f = searchParams.get("filter");
    if (f === "unpriced" || f === "nolink") { setListFocus(f); setView("list"); }
    // Deep-link from the dashboard FAB (manager): open the create-lesson dialog,
    // then strip the param so a refresh doesn't re-open it.
    if (searchParams.get("create") === "1" && canCreate) {
      if (isManager) {
        // Менеджер отримує НОВУ канонічну форму (QuickLessonDialog manager-mode);
        // стара інлайн-форма для нього більше не відкривається.
        setQuickSlot(new Date());
        setSearchParams({}, { replace: true });
        return;
      }
      setCreateOpen(true);
      // Optional student prefill (e.g. deep-link from Chats "create lesson").
      const presetStudent = searchParams.get("student");
      if (presetStudent) setForm((f) => ({ ...f, student_id: presetStudent }));
      const n = new URLSearchParams(searchParams);
      n.delete("create");
      n.delete("student");
      setSearchParams(n, { replace: true });
    }
    // лише при першому відкритті за посиланням
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppLayout>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="hidden lg:flex font-display text-xl font-bold text-foreground sm:text-2xl items-center gap-2">
            <span>📅</span>
            <span className="truncate">{t('schedule.pageTitle')}</span>
          </h1>
          {!isManager && (
            <p className="text-[14px] text-muted-foreground sm:text-sm">
              {isTutor ? t("schedule.tutorSubtitle") : t("schedule.studentSubtitle")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden sm:block">
            <SegSwitch<"list" | "week">
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: t("schedule.listView"), icon: <List className="h-3.5 w-3.5" /> },
                { value: "week", label: t("schedule.weekView"), icon: <CalendarRange className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
          <div className="hidden sm:block">
            <ScheduleFiltersSheet
              filters={filters}
              showTutorFilter={isManager}
              showStudentFilter={isManager || isTutor}
              showSourceFilter={hasMixedSources}
              tutors={tutors}
              students={students}
            />
          </div>
          {isPureStudent && studentTutors.length === 0 && (
            <FindTutorDialog
              trigger={
                <Button size="sm" className="h-10 gap-1.5">
                  <HandHeart className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("scheduleExtra.requestTutor")}</span>
                </Button>
              }
            />
          )}
          {canCreate && (
            <Dialog open={createOpen} onOpenChange={(open) => {
              setCreateOpen(open);
              if (!open) setFormErrors({});
            }}>
              {/* Trigger moved to FAB */}
              <DialogContent className="w-full max-w-[480px] p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] flex flex-col">
                <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-border sm:hidden" />
                <DialogHeader className="px-6 pt-4 pb-2 shrink-0">
                  <DialogTitle className="text-foreground">{t('schedule.newLesson')}</DialogTitle>
                  <div className="mt-2 flex items-center gap-2 text-[14px] text-muted-foreground">
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-semibold",
                      step === 1 ? "bg-primary text-primary-foreground" : "bg-success/15 text-success")}>1</span>
                    <span className={step === 1 ? "text-foreground font-medium" : ""}>{t('schedule.step1')}</span>
                    <span className="h-px flex-1 bg-border" />
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-semibold",
                      step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>2</span>
                    <span className={step === 2 ? "text-foreground font-medium" : ""}>{t('schedule.step2')}</span>
                  </div>
                </DialogHeader>
                <div className="space-y-4 px-6 py-2 overflow-y-auto flex-1">
                  {step === 1 && (<>
                  <div>
                    <Label className={cn(formErrors.tutor_id && "text-destructive")}>
                      {t('roles.tutor')} <span className="text-destructive">*</span>
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
                        <SelectValue placeholder={t('schedule.selectTutor')} />
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
                    <p className="mt-1 text-[14px] text-destructive">{t('schedule.selectTutor')}</p>
                  )}
                </div>
                <div>
                  <Label className={cn(formErrors.student_id && "text-destructive")}>
                    {t('schedule.student')} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.student_id}
                    onValueChange={(v) => {
                      setForm((f) => ({ ...f, student_id: v }));
                      // B18: та сама пара +7 днів, якщо час іще не чіпали.
                      void (async () => {
                        const tid = form.tutor_id || user?.id || "";
                        if (!tid || !v || formTimeTouchedRef.current) return;
                        const d = await pairNextDefault(tid, v);
                        if (d && !formTimeTouchedRef.current) {
                          setForm((f) => ({ ...f, starts_at: toLocalInputValue(d.toISOString()) }));
                        }
                      })();
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
                      <SelectValue placeholder={t('schedule.selectStudent')} />
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
                    <p className="mt-1 text-[14px] text-destructive">{t('schedule.selectStudent')}</p>
                  )}
                  {students.length === 0 && isTutor && !isManager && (
                    <div className="mt-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-[14px]">
                      <p className="text-muted-foreground mb-2">
                        {isIndependentTutor
                          ? t('schedule.noStudentsIndependent')
                          : t('schedule.noStudentsHub')}
                      </p>
                      {isIndependentTutor ? (
                        <Button asChild size="sm" variant="outline" className="h-7 text-[14px]">
                          <Link to="/my-students" onClick={() => setCreateOpen(false)}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            {t("myStudents.addStudentBtn")}
                          </Link>
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline" className="h-7 text-[14px]">
                          <Link to="/chats" onClick={() => setCreateOpen(false)}>
                            {t("schedule.messageManagerBtn")}
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="subject" className={cn(formErrors.subject && "text-destructive")}>
                    {t('schedule.subject')} <span className="text-destructive">*</span>
                  </Label>
                  <SubjectComboBox
                    value={form.subject}
                    onChange={(v) => {
                      setForm((f) => ({ ...f, subject: v }));
                      if (formErrors.subject && v.trim()) {
                        setFormErrors((er) => ({ ...er, subject: false }));
                      }
                    }}
                    extraOptions={subjectOptions}
                    className={cn(
                      formErrors.subject &&
                        "border-destructive ring-1 ring-destructive"
                    )}
                  />
                  {formErrors.subject && (
                    <p className="mt-1 text-[14px] text-destructive">{t('schedule.selectSubject')}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="starts_at" className={cn(formErrors.starts_at && "text-destructive")}>
                    {t('schedule.dateTime')} <span className="text-destructive">*</span>
                  </Label>
                  <DateTimeField
                    value={form.starts_at}
                    invalid={!!formErrors.starts_at}
                    onChange={(v) => {
                      formTimeTouchedRef.current = true; // B18: користувач сам обрав час
                      setForm((f) => ({ ...f, starts_at: v }));
                      if (formErrors.starts_at && v) {
                        setFormErrors((er) => ({ ...er, starts_at: false }));
                      }
                    }}
                  />
                  {formErrors.starts_at && (
                    <p className="mt-1 text-[14px] text-destructive">{t('schedule.dateTime')}</p>
                  )}
                </div>
                </>)}
                {step === 2 && (<>
                <div>
                  <Label htmlFor="duration">{t('schedule.duration')}</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="15"
                    step="15"
                    value={form.duration_minutes}
                    onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                  />
                </div>
                {isIndependentTutor && form.tutor_id && form.student_id && form.subject && (
                  <div>
                    <Label htmlFor="indep_student_price" className="flex items-center gap-1.5">
                      {t('schedule.pricePerLesson')}
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
                    <p className="mt-1 text-[14px] text-muted-foreground">
                      {existingRateForPair
                        ? `💡 ${t('schedule.priceHintExisting')}`
                        : `🆕 ${t('schedule.priceHintNew')}`}
                    </p>
                  </div>
                )}
                {isManager && (
                  <>
                    <div>
                      <Label>{t('common.status')}</Label>
                      <Select
                        value={form.status}
                        onValueChange={(v) => setForm((f) => ({ ...f, status: v as LessonStatus }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('common.status')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">{t('schedule.statusPending')}</SelectItem>
                          <SelectItem value="scheduled">{t('schedule.statusScheduled')}</SelectItem>
                          <SelectItem value="completed">{t('schedule.statusCompleted')}</SelectItem>
                          <SelectItem value="cancelled">{t('schedule.statusCancelled')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="student_price" className="flex items-center gap-1.5">
                          {t('schedule.pricePerLesson')}
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
                          {t('schedule.tutorPayout')}
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
                          <p className="text-[14px] text-warning -mt-2">
                            {t('schedule.noPriceSetWarning')}
                          </p>
                        )}
                        <p className="text-[14px] text-muted-foreground -mt-2">
                          {t('schedule.priceSourceHint')}
                        </p>
                      </>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>{t('common.status')}</Label>
                        <Select
                          value={form.student_payment_status}
                          onValueChange={(v) => setForm((f) => ({ ...f, student_payment_status: v as PaymentStatus }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('common.status')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unpaid">{t('schedule.unpaid')}</SelectItem>
                            <SelectItem value="paid">{t('schedule.paid')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>{t('schedule.tutorPayout')}</Label>
                        <Select
                          value={form.tutor_payout_status}
                          onValueChange={(v) => setForm((f) => ({ ...f, tutor_payout_status: v as PaymentStatus }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('common.status')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unpaid">{t('schedule.unpaid')}</SelectItem>
                            <SelectItem value="paid">{t('schedule.paid')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}
                {isStudent && !isManager && !isTutor && (
                  <p className="text-[14px] text-muted-foreground">
                    {t("schedule.studentRequestHint")}
                  </p>
                )}
                {conflictWarning && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[14px] text-warning">
                    ⚠ {conflictWarning}
                  </div>
                )}
                {(isManager || isTutor) && (
                  <div>
                    <Label htmlFor="repeat">{t("scheduleExtra.repeatWeekly")}</Label>
                    <Select value={repeatWeeks} onValueChange={setRepeatWeeks}>
                      <SelectTrigger id="repeat"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t("scheduleExtra.noRepeat")}</SelectItem>
                        <SelectItem value="2">{t("scheduleExtra.weeks2")}</SelectItem>
                        <SelectItem value="4">{t("scheduleExtra.weeks4")}</SelectItem>
                        <SelectItem value="8">{t("scheduleExtra.weeks8")}</SelectItem>
                        <SelectItem value="12">{t("scheduleExtra.weeks12")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="pt-1">
                  <div className="space-y-1.5">
                    <Label>{t('schedule.meetingUrl')}</Label>
                    <Input value={form.meeting_url} onChange={(e) => setForm({ ...form, meeting_url: e.target.value })} placeholder="https://meet.google.com/…" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotesOpen((v) => !v)}
                    className="flex items-center gap-2 text-[14px] text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    <span className="flex-1 text-left">
                      {t('schedule.notes')} {form.notes ? `(${form.notes.length})` : `(${t('common.optional')})`}
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
                      placeholder={t('schedule.notesPlaceholder')}
                    />
                  )}
                </div>
                </>)}
              </div>
              <DialogFooter className="px-6 pb-6 pt-3 border-t border-border bg-background shrink-0 flex-row justify-between sm:justify-between gap-2">
                {step === 1 ? (
                  <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    ← {t('common.back')}
                  </Button>
                )}
                <div className="flex gap-2">
                  {step === 1 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Lightweight validation before jumping to step 2
                        const errs: typeof formErrors = {};
                        if (!form.tutor_id) errs.tutor_id = true;
                        if (!form.student_id) errs.student_id = true;
                        if (!form.subject || !form.subject.trim()) errs.subject = true;
                        if (!form.starts_at) errs.starts_at = true;
                        if (Object.keys(errs).length) {
                          setFormErrors(errs);
                          toast.error(t('common.fillRequired'));
                          return;
                        }
                        setFormErrors({});
                        setStep(2);
                      }}
                      className="border-[1.5px] border-[#F5B544] bg-[#FFF7E6] text-[#9a6a12] hover:bg-[#FFEFD0] dark:bg-transparent dark:text-[#F5C56A] dark:hover:bg-[#F5B544]/15"
                    >
                      {t('schedule.step2')}
                    </Button>
                  )}
                  <Button onClick={handleCreate} disabled={submitting}
                    className="border-0 bg-[#F5B544] font-bold text-[#3d2a06] hover:bg-[#EFA92B]">
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('common.save')}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      </div>

      {/* Mobile: view switcher + filter in one row */}
      <div className="flex items-center gap-2 mb-4 sm:hidden">
        <div className="flex-1">
          <SegSwitch<"list" | "week">
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: t("schedule.listView"), icon: <List className="h-3.5 w-3.5" /> },
              { value: "week", label: t("schedule.weekView"), icon: <CalendarRange className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>
        <ScheduleFiltersSheet
          filters={filters}
          showTutorFilter={isManager}
          showStudentFilter={isManager || isTutor}
          showSourceFilter={hasMixedSources}
          tutors={tutors}
          students={students}
        />
      </div>

      {/* Top "Lessons / My hours" tab switcher removed — availability now lives on /availability and is linked at the bottom of this page. */}

      <>
      {studentTutors.length > 0 && (
        <div className="mb-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-foreground">{t("schedulePageExtra.tutorsHoursTitle")}</h2>
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
        <ScheduleSkeleton />
      ) : view === "week" ? (
        <WeekCalendar
          chipPerson={isTutor || isManager ? "student" : "tutor"}
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
            if (isTutor && !isManager) {
              // Both tutor kinds get the modern quick dialog (hub variant reads hub
              // students + creates source='hub'); only the manager needs the full
              // form (tutor picker).
              setQuickSlot(date);
              return;
            }
            setForm((f) => ({ ...f, starts_at: toLocalInputValue(date.toISOString()) }));
            setCreateOpen(true);
          }}
          onLessonClick={(l) => setDetailsLessonId(l.id)}
          nameOf={(id) => profilesMap[id] ?? "?"}
        />
      ) : loading ? (
        <ScheduleSkeleton />
      ) : (
        <>
        {isPureStudentForList && (
          <div className="mb-4">
            <SegSwitch<"upcoming" | "past">
              value={studentArchive}
              onChange={setStudentArchive}
              options={[
                { value: "upcoming", label: t("common.upcoming"), icon: <Clock className="h-3.5 w-3.5" /> },
                { value: "past", label: t("common.archive"), icon: <CalendarDays className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
        )}
        {listFocus && (
          <div className="mb-3 flex items-center gap-2">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 8px 0 13px",
              borderRadius: 999, background: "rgba(245,158,11,.14)", border: "1px solid rgba(245,158,11,.35)",
              fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, color: "#b4740b" }}>
              {listFocus === "unpriced" ? t("schedule.focusUnpriced") : t("schedule.focusNoLink")}
              <button type="button" aria-label={t("schedule.clearFilterAria")}
                onClick={() => { setListFocus(null); const n = new URLSearchParams(searchParams); n.delete("filter"); setSearchParams(n, { replace: true }); }}
                style={{ width: 22, height: 22, borderRadius: 999, border: "none", cursor: "pointer",
                  background: "rgba(180,116,11,.15)", color: "#b4740b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, lineHeight: 1 }}>
                ✕
              </button>
            </span>
          </div>
        )}
        {grouped.length === 0 ? (
        isPureStudent && studentTutors.length === 0 ? (
          <EmptyState
            icon={HandHeart}
            title={t('schedule.noTutorTitle')}
            description={t('schedule.noTutorDesc')}
          >
            <FindTutorDialog
              trigger={
                <Button>
                  <HandHeart className="h-4 w-4 mr-2" />
                  {t('dashboard.btnRequestTutor')}
                </Button>
              }
            />
          </EmptyState>
        ) : (
          <EmptyState
            icon={Clock}
            title={t('schedule.noLessonsTitle')}
            description={
              canCreate
                ? t('schedule.noLessonsDescCreate')
                : t('schedule.noLessonsDescWait')
            }
            actionLabel={canCreate ? t('schedule.createFirstLesson') : undefined}
            onAction={canCreate ? () => setCreateOpen(true) : undefined}
          />
        )
      ) : (
        <div className="space-y-6">
          {grouped.map(([bucketLabel, dayLessons]) => {
            const isToday = bucketLabel === t('common.today');
            const isPast = bucketLabel === t('schedule.bucketPast');
            const shown = isPast ? dayLessons.slice(0, pastLimit) : dayLessons;
            const hiddenPast = dayLessons.length - shown.length;
            return (
              <div key={bucketLabel}>
                <h3
                  className={`font-display text-sm font-semibold mb-3 ${
                    isToday ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {bucketLabel}
                  <span className="ml-2 text-[14px] font-normal opacity-70">· {dayLessons.length}</span>
                </h3>
                <div className="space-y-2">
                  {shown.map((lesson) => {
                    const tutorName = profilesMap[lesson.tutor_id] ?? "?";
                    // Group lessons have no student_id — label the card honestly.
                    const studentName = lesson.student_id ? (profilesMap[lesson.student_id] ?? "?") : t("groupLessons.cardLabel");
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
                        // Parity with the Dashboard: hub tutors see their 💼 payout row
                        // here too (money masked per-role server-side anyway).
                        showPayout={isManager || lesson.source === "hub"}
                        role={isManager ? "manager" : (isPureStudent && lesson.student_id === user?.id) ? "student" : "tutor"}
                        studentName={studentName}
                        tutorName={tutorName}
                        showTutor={isManager || (isPureStudent && lesson.student_id === user?.id)}
                        meetingUrl={lesson.meeting_url ?? defaultMeetingUrls[`${lesson.tutor_id}:${lesson.student_id}`] ?? null}
                        onJoin={() => { logEvent("join_clicked", { from: "schedule" }); void maybeAutoStartFireflies(lesson.id, lesson.meeting_url ?? defaultMeetingUrls[`${lesson.tutor_id}:${lesson.student_id}`] ?? ""); }}
                        chatPartnerId={user?.id === lesson.tutor_id ? lesson.student_id : lesson.tutor_id}
                        className={lessonSourceTint(lesson.source)}
                        canEditStatus={canEditStatus}
                        statusOptions={isManager
                          ? (["pending", "scheduled", "completed", "cancelled"] as LessonStatus[])
                          : (["scheduled", "completed", "cancelled"] as LessonStatus[])}
                        onStatusChange={canEditStatus ? (s) => updateStatus(lesson.id, s) : undefined}
                        onPayChange={
                          (isManager || (isTutor && lesson.tutor_id === user?.id))
                            ? (field, paid) =>
                                updatePayment(
                                  lesson.id,
                                  field === "student" ? "student_payment_status" : "tutor_payout_status",
                                  (paid ? "paid" : "unpaid") as PaymentStatus,
                                )
                            : undefined
                        }
                        onContentClick={() => setDetailsLessonId(lesson.id)}
                        onEdit={(isManager || (isTutor && lesson.tutor_id === user?.id)) ? () => setDetailsLessonId(lesson.id) : undefined}
                        canEdit={isManager || (isTutor && lesson.tutor_id === user?.id)}
                        onCopy={canCopy ? () => openCopy(lesson) : undefined}
                        canCopy={canCopy}
                        onDelete={canDelete ? () => setPendingDelete(lesson.id) : undefined}
                        canDelete={canDelete}
                        studentActions={
                          isPureStudent && lesson.student_id === user?.id ? (
                            <StudentLessonActions
                              lessonId={lesson.id}
                              tutorId={lesson.tutor_id}
                              startsAt={lesson.starts_at}
                              status={lesson.status}
                            />
                          ) : undefined
                        }
                      />
                    );
                  })}
                </div>
                {isPast && hiddenPast > 0 && (
                  <button
                    type="button"
                    onClick={() => setPastLimit((n) => n + 12)}
                    className="mt-2 w-full rounded-[12px] border border-border bg-white py-2.5 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
                  >
                    {t("schedule.showMorePast", { count: hiddenPast })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
      </>

      {(isManager || isTutor) && (
        <div className="mt-8 border-t border-border pt-4 text-center">
          <Link
            to="/availability"
            className="text-sm text-primary hover:underline"
          >
            {t("schedule.availabilityLink")}
          </Link>
        </div>
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
        variant={isManager ? "manager" : isIndependentTutor ? "independent" : "hub"}
      />
      {canCreate && (
        <PageFAB
          onClick={() => {
            if (isTutor && !isManager) {
              // Tutors land in the modern quick dialog; time defaults to the next
              // full hour and is editable inside the dialog.
              const d = new Date();
              d.setMinutes(0, 0, 0);
              d.setHours(d.getHours() + 1);
              setQuickSlot(d);
              return;
            }
            setCreateOpen(true);
          }}
          label={t("schedule.createBtn")}
        />
      )}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("schedulePageExtra.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("schedulePageExtra.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("schedulePageExtra.cancelBtn")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) deleteLesson(pendingDelete);
                setPendingDelete(null);
              }}
            >
              {t("schedulePageExtra.deleteBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LessonDetailsDialog
        lessonId={detailsLessonId}
        open={!!detailsLessonId}
        onOpenChange={(o) => { if (!o) setDetailsLessonId(null); }}
        onUpdated={loadAll}
      />
    </AppLayout>
  );
}
