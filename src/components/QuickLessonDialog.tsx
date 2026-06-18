import { useEffect, useMemo, useState } from "react";
import { getLocale } from "@/lib/locale";
import { supabase } from "@/integrations/supabase/client";
import { insertNotification } from "@/lib/notifications";
import { createGroupLesson } from "@/lib/groupLessons";
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
import { Loader2, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncLessonToGoogleCalendar } from "@/lib/googleCalendarSync";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";
import { formatPrice } from "@/lib/currency";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  startsAt: Date | null;
  onCreated?: () => void;
  onWantFullForm?: (startsAt: Date) => void;
  initialStudentId?: string | null;
}

interface StudentRow {
  student_id: string;
  subject: string;
  price: number;
  currency?: string | null;
  name: string;
  default_meeting_url?: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  subject: string | null;
  participants: { student_id: string }[];
}

const LAST_KEY = "tutorhub.lastQuickStudentId";
const LAST_MODE_KEY = "tutorhub.lastQuickMode";
const LAST_GROUP_KEY = "tutorhub.lastQuickGroupId";

type Mode = "individual" | "group";

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
  initialStudentId,
}: Props) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [duration, setDuration] = useState<string>("60");
  const [mode, setMode] = useState<Mode>(
    (localStorage.getItem(LAST_MODE_KEY) as Mode) || "individual"
  );
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [whenLocal, setWhenLocal] = useState<Date | null>(null);
  const [timeEditOpen, setTimeEditOpen] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(0);

  useEffect(() => {
    if (open) { setWhenLocal(null); setTimeEditOpen(false); setRepeatWeeks(0); }
  }, [open, startsAt]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: rates }, { data: gs }] = await Promise.all([
        supabase
          .from("student_rates")
          .select("student_id, subject, price_per_lesson, currency, archived_at")
          .eq("tutor_id", user.id)
          .eq("source", "independent"),
        supabase
          .from("lesson_groups")
          .select("id, name, subject")
          .eq("tutor_id", user.id)
          .order("created_at", { ascending: false }),
      ]);
      const active = (rates ?? []).filter((r: any) => !r.archived_at);
      const ids = Array.from(new Set(active.map((r: any) => r.student_id)));
      let rows: StudentRow[] = [];
      if (ids.length) {
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
            `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("quickLessonDialog.studentFallback"),
          ])
        );
        const meetOf = new Map(
          (defaults ?? []).map((d: any) => [d.student_id, d.default_meeting_url])
        );
        const byStudent = new Map<string, any>();
        active.forEach((r: any) => {
          if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, r);
        });
        rows = Array.from(byStudent.values()).map((r: any) => ({
          student_id: r.student_id,
          subject: r.subject || "",
          price: Number(r.price_per_lesson ?? 0),
          currency: r.currency ?? "UAH",
          name: nameOf.get(r.student_id) ?? t("shared.student"),
          default_meeting_url: (meetOf.get(r.student_id) as string | null) ?? null,
        }));
        rows.sort((a, b) => a.name.localeCompare(b.name, "uk"));
      }

      // Load enrollments for groups
      const groupIds = (gs ?? []).map((g: any) => g.id);
      const participantsByGroup = new Map<string, { student_id: string }[]>();
      if (groupIds.length) {
        const { data: ens } = await supabase
          .from("group_enrollments")
          .select("group_id, student_id, status")
          .in("group_id", groupIds)
          .eq("status", "active");
        (ens ?? []).forEach((e: any) => {
          const list = participantsByGroup.get(e.group_id) ?? [];
          list.push({ student_id: e.student_id });
          participantsByGroup.set(e.group_id, list);
        });
      }
      const groupRows: GroupRow[] = (gs ?? []).map((g: any) => ({
        id: g.id,
        name: g.name,
        subject: g.subject,
        participants: participantsByGroup.get(g.id) ?? [],
      }));

      if (cancelled) return;
      setStudents(rows);
      setGroups(groupRows);
      const last = localStorage.getItem(LAST_KEY);
      const initial =
        (initialStudentId && rows.find((r) => r.student_id === initialStudentId)?.student_id) ||
        rows.find((r) => r.student_id === last)?.student_id ||
        rows[0]?.student_id ||
        "";
      setStudentId(initial);
      const lastGroup = localStorage.getItem(LAST_GROUP_KEY);
      const initialGroup =
        groupRows.find((g) => g.id === lastGroup)?.id || groupRows[0]?.id || "";
      setGroupId(initialGroup);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, initialStudentId, reloadTrigger]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === groupId) ?? null,
    [groups, groupId]
  );

  const selected = useMemo(
    () => students.find((s) => s.student_id === studentId) ?? null,
    [students, studentId]
  );

  const effStartsAt = whenLocal ?? startsAt;

  const submit = async () => {
    if (!user || !effStartsAt) return;

    if (mode === "individual" && students.length === 0) {
      toast.error(t("quickLessonDialog.addStudentFirst"));
      return;
    }

    if (mode === "group") {
      if (!selectedGroup) {
        toast.error(t("quickLessonDialog.selectGroup") ?? "Виберіть групу");
        return;
      }
      setSubmitting(true);
      // Shared helper: snapshots each participant's group price into
      // lesson_participants + notifies every enrolled student.
      const { lessonId, error } = await createGroupLesson({
        tutorId: user.id,
        groupId: selectedGroup.id,
        subject: selectedGroup.subject || t("shared.lesson"),
        startsAt: effStartsAt.toISOString(),
        durationMinutes: parseInt(duration) || 60,
        source: "independent",
        createdBy: user.id,
      });
      setSubmitting(false);
      if (error || !lessonId) {
        toast.error(error || (t("schedule.createLessonFailed") ?? "Не вдалося створити урок"));
        return;
      }
      localStorage.setItem(LAST_MODE_KEY, "group");
      localStorage.setItem(LAST_GROUP_KEY, selectedGroup.id);
      toast.success(t("quickLessonDialogExtra.groupCreated", { name: selectedGroup.name }));
      void syncLessonToGoogleCalendar(lessonId, "upsert");
      onOpenChange(false);
      onCreated?.();
      return;
    }

    if (!selected) return;
    if (!selected.subject) {
      toast.error(t("quickLessonDialogExtra.studentNoSubject"));
      return;
    }
    setSubmitting(true);
    const seriesCount = repeatWeeks > 0 ? repeatWeeks : 1;
    const basePayload = {
      tutor_id: user.id,
      student_id: selected.student_id,
      subject: selected.subject,
      duration_minutes: parseInt(duration) || 60,
      status: "scheduled" as const,
      created_by: user.id,
      source: "independent",
      meeting_url: selected.default_meeting_url || null,
    };
    const payloads = Array.from({ length: seriesCount }, (_, i) => ({
      ...basePayload,
      starts_at: new Date(effStartsAt.getTime() + i * 7 * 86400000).toISOString(),
    }));
    const { data: createdRows, error } = await supabase
      .from("lessons")
      .insert(payloads)
      .select("id");
    const created = createdRows?.[0] ?? null;
    if (!error && createdRows?.length) {
      await Promise.all(
        createdRows.map((r) =>
          supabase
            .from("lesson_details")
            .upsert(
              { lesson_id: r.id, student_price: selected.price || 0, tutor_payout: 0 } as any,
              { onConflict: "lesson_id" }
            )
        )
      );
    }
    setSubmitting(false);
    if (error) {
      console.error(error);
      toast.error(error.message || t("quickLessonDialogExtra.lessonCreateFailed"));
      return;
    }
    localStorage.setItem(LAST_KEY, selected.student_id);
    createdRows?.forEach((r) => void syncLessonToGoogleCalendar(r.id, "upsert"));
    // Notify student that a new lesson has been scheduled
    if (created && selected.student_id) {
      const dateStr = effStartsAt.toLocaleString(getLocale(), {
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      });
      insertNotification({
        userId: selected.student_id,
        type: `lesson_scheduled_${created.id}`,
        title: t("quickLessonDialog.notifLessonScheduledTitle"),
        body: seriesCount > 1
          ? t("quickLessonDialog.notifLessonSeriesBody", { count: seriesCount, date: dateStr })
          : t("quickLessonDialog.notifLessonScheduledBody", { date: dateStr }),
        link: "/schedule",
      });

      // TAIL D — if the tutor enabled a notify channel, also send the cancellation
      // rules to the student as an in-app notification. Telegram/email delivery is a
      // future edge function; this implements only the in-app channel. The cancel-rule
      // columns may not exist in the live DB until the D migration is applied, so we
      // read defensively (optional chaining / defaults) and simply skip when absent.
      // Wrapped in try/catch — must NEVER block or fail lesson creation.
      try {
        const { data: ws } = await supabase
          .from("tutor_workspace_settings")
          .select(
            "notify_telegram, notify_email, cancel_free_hours, cancel_fee_percent, noshow_charge, free_reschedules_per_month"
          )
          .eq("tutor_id", user.id)
          .maybeSingle();
        const s = (ws ?? {}) as Record<string, unknown>;
        const notifyTelegram = (s.notify_telegram as boolean | undefined) ?? false;
        const notifyEmail = (s.notify_email as boolean | undefined) ?? false;
        if (notifyTelegram || notifyEmail) {
          const rules = t("quickLessonDialog.notifCancellationRulesBody", {
            hours: Number(s.cancel_free_hours ?? 24),
            fee: Number(s.cancel_fee_percent ?? 50),
            noshow: Number(s.noshow_charge ?? 100),
            reschedules: Number(s.free_reschedules_per_month ?? 0),
          });
          insertNotification({
            userId: selected.student_id,
            type: `cancellation_rules_${created.id}`,
            title: t("quickLessonDialog.notifCancellationRulesTitle"),
            body: rules,
            link: "/schedule",
          });

          // Also deliver the rules to the student via Telegram + email.
          // Fire-and-forget: the edge function re-reads settings server-side and
          // hardcodes the uk copy. Must NEVER block or fail lesson creation.
          void supabase.functions
            .invoke("notify-lesson-rules", { body: { lessonId: created.id } })
            .catch((err) =>
              console.error("[QuickLessonDialog] notify-lesson-rules failed:", err)
            );
        }
      } catch (e) {
        // Best-effort only — never block lesson creation on a notification failure.
        console.error("[QuickLessonDialog] cancellation-rules notify failed:", e);
      }
    }
    localStorage.setItem(LAST_MODE_KEY, "individual");
    const timeStr = effStartsAt.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
    toast.success(
      seriesCount > 1
        ? t("quickLessonDialog.seriesCreated", { count: seriesCount, name: selected.name, time: timeStr })
        : `${t("quickLessonDialogExtra.lessonCreated", { name: selected.name, time: timeStr })}`
    );
    onOpenChange(false);
    onCreated?.();
  };

  const canSubmit =
    !submitting && (mode === "individual" ? !!selected : !!selectedGroup);

  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const heroDate = effStartsAt
    ? cap(effStartsAt.toLocaleDateString(getLocale(), { weekday: "short", day: "numeric", month: "long" }))
    : "";
  const heroTime = effStartsAt
    ? effStartsAt.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })
    : "";
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const ymd = effStartsAt ? `${effStartsAt.getFullYear()}-${pad2(effStartsAt.getMonth() + 1)}-${pad2(effStartsAt.getDate())}` : "";
  const hm = effStartsAt ? `${pad2(effStartsAt.getHours())}:${pad2(effStartsAt.getMinutes())}` : "";
  const setDatePart = (v: string) => {
    if (!effStartsAt || !v) return;
    const [y, m, d] = v.split("-").map(Number);
    const next = new Date(effStartsAt); next.setFullYear(y, m - 1, d); setWhenLocal(next);
  };
  const setTimePart = (v: string) => {
    if (!effStartsAt || !v) return;
    const [h, mi] = v.split(":").map(Number);
    const next = new Date(effStartsAt); next.setHours(h, mi, 0, 0); setWhenLocal(next);
  };

  // ── Design tokens ─────────────────────────────────────────────────────────────
  const F = {
    teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9",
    border: "#eceef3", bg: "#F5F4F0", surface: "#fff",
    txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8",
    display: "Inter, system-ui, sans-serif",
    body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };
  const GRADIENTS = [
    "linear-gradient(135deg,#2BBFAA,#1d8f7e)",
    "linear-gradient(135deg,#6366F1,#4f46e5)",
    "linear-gradient(135deg,#F59E0B,#d97706)",
    "linear-gradient(135deg,#EF4444,#dc2626)",
    "linear-gradient(135deg,#EC4899,#db2777)",
    "linear-gradient(135deg,#8B5CF6,#7c3aed)",
    "linear-gradient(135deg,#F97316,#ea580c)",
    "linear-gradient(135deg,#14B8A6,#0d9488)",
  ];
  const ava = (name: string) => GRADIENTS[(name.charCodeAt(0) + (name.charCodeAt(1)||0)) % GRADIENTS.length];
  const initials = (name: string) => (name.trim().split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase());

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[440px] p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0 sm:hidden">
            <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
          </div>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 22px 10px", flexShrink: 0 }}>
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 21, color: F.txt, letterSpacing: "-.01em" }}>
              {t("quickLessonDialog.newLessonTitle")}
            </div>
            <button onClick={() => onOpenChange(false)} aria-label={t("quickLessonDialog.cancelBtn")}
              style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, border: "none", background: F.bg, color: F.sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 22px 12px", display: "flex", flexDirection: "column", gap: 14 }}>
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: F.muted }} />
              </div>
            ) : students.length === 0 && groups.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p style={{ fontSize: 14.5, color: F.sub, marginBottom: 14, fontFamily: F.body }}>
                  {t("quickLessonDialog.noStudentsHint")}
                </p>
                <button onClick={() => setAddStudentOpen(true)}
                  style={{ height: 46, padding: "0 20px", borderRadius: 12, border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a",
                    fontFamily: F.display, fontWeight: 700, fontSize: 14.5 }}>
                  + {t("quickLessonDialog.addStudentBtn")}
                </button>
              </div>
            ) : (
              <>
                {/* Time hero */}
                <div style={{ borderRadius: 16, background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", color: "#fff", padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: F.display, fontWeight: 700, whiteSpace: "nowrap" }}>{heroDate}</div>
                      <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 30, letterSpacing: "-.02em", marginTop: 2 }}>{heroTime}</div>
                    </div>
                    <button type="button" onClick={() => setTimeEditOpen((v) => !v)}
                      style={{ height: 40, padding: "0 14px", borderRadius: 11, border: "none", cursor: "pointer", flexShrink: 0,
                        background: timeEditOpen ? "rgba(43,191,170,.35)" : "rgba(255,255,255,.14)", color: "#fff",
                        fontFamily: F.display, fontWeight: 700, fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Clock size={16} /> {t("quickLessonDialog.changeTimeBtn")}
                    </button>
                  </div>
                  {timeEditOpen && (
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <input type="date" value={ymd} onChange={(e) => setDatePart(e.target.value)}
                        style={{ flex: 1, height: 44, borderRadius: 11, border: "none", padding: "0 12px",
                          background: "rgba(255,255,255,.12)", color: "#fff", fontFamily: F.body, fontSize: 14.5,
                          outline: "none", colorScheme: "dark" }} />
                      <input type="time" value={hm} onChange={(e) => setTimePart(e.target.value)}
                        style={{ width: 110, height: 44, borderRadius: 11, border: "none", padding: "0 12px",
                          background: "rgba(255,255,255,.12)", color: "#fff", fontFamily: F.body, fontSize: 14.5,
                          outline: "none", colorScheme: "dark", flexShrink: 0 }} />
                    </div>
                  )}
                </div>

                {/* Duration chips */}
                <div style={{ display: "flex", gap: 8 }}>
                  {["30","45","60","90","120"].map(d => {
                    const on = duration === d;
                    return (
                      <button key={d} onClick={() => setDuration(d)}
                        style={{ flex: 1, height: 44, borderRadius: 12, cursor: "pointer",
                          border: `1.5px solid ${on ? F.teal : F.border}`,
                          background: on ? F.tealL : F.surface,
                          fontFamily: F.display, fontWeight: 700, fontSize: 14,
                          color: on ? F.tealD : F.txt }}>
                        {d}
                      </button>
                    );
                  })}
                </div>

                {/* Repeat weekly (individual only) */}
                {mode === "individual" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => setRepeatWeeks((v) => (v > 0 ? 0 : 4))}
                      style={{ height: 44, padding: "0 13px", borderRadius: 999, cursor: "pointer",
                        border: `1.5px solid ${repeatWeeks > 0 ? F.teal : F.border}`,
                        background: repeatWeeks > 0 ? F.tealL : F.surface,
                        color: repeatWeeks > 0 ? F.tealD : F.sub,
                        fontFamily: F.display, fontWeight: 700, fontSize: 13.5,
                        display: "inline-flex", alignItems: "center", gap: 6 }}>
                      🔁 {t("quickLessonDialog.weeklyToggle")}
                    </button>
                    {repeatWeeks > 0 && [4, 8, 12].map((n) => (
                      <button key={n} type="button" onClick={() => setRepeatWeeks(n)}
                        style={{ height: 44, padding: "0 12px", borderRadius: 999, cursor: "pointer",
                          border: `1.5px solid ${repeatWeeks === n ? F.teal : F.border}`,
                          background: repeatWeeks === n ? F.tealL : F.surface,
                          color: repeatWeeks === n ? F.tealD : F.txt,
                          fontFamily: F.display, fontWeight: 700, fontSize: 13.5 }}>
                        ×{n}
                      </button>
                    ))}
                    {repeatWeeks > 0 && (
                      <span style={{ fontSize: 13, color: F.muted, fontFamily: F.body }}>
                        {t("quickLessonDialog.weeksInARow", { count: repeatWeeks })}
                      </span>
                    )}
                  </div>
                )}

                {/* Mode toggle (only when groups exist) */}
                {groups.length > 0 && (
                  <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "rgba(15,15,26,.06)" }}>
                    {([["individual","👤 " + t("quickLessonDialog.modeIndividual")], ["group","👥 " + t("quickLessonDialog.modeGroup")]] as const).map(([m, l]) => (
                      <button key={m} onClick={() => setMode(m as Mode)}
                        style={{ flex: 1, height: 38, borderRadius: 9, border: "none", cursor: "pointer",
                          background: mode === m ? F.surface : "transparent",
                          boxShadow: mode === m ? "0 1px 4px rgba(15,15,26,.06)" : "none",
                          fontFamily: F.display, fontWeight: 700, fontSize: 13.5,
                          color: mode === m ? F.txt : F.sub }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )}

                {/* Student cards */}
                {mode === "individual" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                    {students.map(s => {
                      const active = studentId === s.student_id;
                      return (
                        <button key={s.student_id} onClick={() => { setStudentId(s.student_id); localStorage.setItem(LAST_KEY, s.student_id); }}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                            borderRadius: 16, textAlign: "left", cursor: "pointer",
                            border: `1.5px solid ${active ? F.teal : F.border}`,
                            background: active ? F.tealL : F.surface,
                            boxShadow: active ? "0 8px 20px -10px rgba(43,191,170,.5)" : "none" }}>
                          <div style={{ width: 44, height: 44, borderRadius: 999, flexShrink: 0,
                            background: ava(s.name), display: "flex", alignItems: "center",
                            justifyContent: "center", fontFamily: F.display, fontWeight: 800, fontSize: 15, color: "#fff" }}>
                            {initials(s.name)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 15.5, color: F.txt,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                            <div style={{ fontSize: 13, color: F.sub, fontFamily: F.body }}>{s.subject} · {formatPrice(s.price, s.currency)}</div>
                          </div>
                          <span style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                            border: `2px solid ${active ? F.teal : F.muted}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {active && <span style={{ width: 11, height: 11, borderRadius: 999, background: F.teal }} />}
                          </span>
                        </button>
                      );
                    })}
                    <button onClick={() => setAddStudentOpen(true)}
                      style={{ height: 44, borderRadius: 12, border: `1px dashed ${F.border}`, cursor: "pointer",
                        background: "transparent", color: F.muted, fontFamily: F.body, fontWeight: 600, fontSize: 14 }}>
                      + {t("quickLessonDialog.addStudentBtn")}
                    </button>
                  </div>
                )}

                {/* Group cards */}
                {mode === "group" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {groups.map(g => {
                      const active = groupId === g.id;
                      return (
                        <button key={g.id} onClick={() => setGroupId(g.id)}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                            borderRadius: 16, textAlign: "left", cursor: "pointer",
                            border: `1.5px solid ${active ? F.teal : F.border}`,
                            background: active ? F.tealL : F.surface,
                            boxShadow: active ? "0 8px 20px -10px rgba(43,191,170,.5)" : "none" }}>
                          <div style={{ width: 44, height: 44, borderRadius: 999, flexShrink: 0,
                            background: ava(g.name), display: "flex", alignItems: "center",
                            justifyContent: "center", fontFamily: F.display, fontWeight: 800, fontSize: 15, color: "#fff" }}>
                            {initials(g.name)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 15.5, color: F.txt }}>{g.name}</div>
                            <div style={{ fontSize: 13, color: F.sub, fontFamily: F.body }}>{g.subject} · {g.participants.length} {t("quickLessonDialog.studentsShort")}</div>
                          </div>
                          <span style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                            border: `2px solid ${active ? F.teal : F.muted}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {active && <span style={{ width: 11, height: 11, borderRadius: 999, background: F.teal }} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Full editor link */}
                {effStartsAt && onWantFullForm && mode === "individual" && (
                  <button onClick={() => { onOpenChange(false); onWantFullForm!(effStartsAt!); }}
                    style={{ alignSelf: "center", background: "transparent", border: "none", cursor: "pointer",
                      fontFamily: F.display, fontWeight: 700, fontSize: 13.5, color: F.sub, padding: "2px 8px" }}>
                    {t("quickLessonDialog.openFullEditor")} →
                  </button>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {!loading && (students.length > 0 || groups.length > 0) && (
            <div style={{ flexShrink: 0, padding: "14px 22px 22px", borderTop: `1px solid ${F.border}`, background: "#fff", display: "flex", gap: 11 }}>
              <button onClick={() => onOpenChange(false)}
                style={{ height: 52, padding: "0 18px", borderRadius: 14, border: `1px solid ${F.border}`,
                  background: "#fff", color: F.sub, fontFamily: F.display, fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
                {t("quickLessonDialog.cancelBtn")}
              </button>
              <button disabled={submitting || !canSubmit} onClick={submit}
                style={{ flex: 1, height: 52, borderRadius: 14, border: "none",
                  cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
                  background: canSubmit ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "rgba(43,191,170,.35)",
                  color: "#0f0f1a", fontFamily: F.display, fontWeight: 700, fontSize: 16,
                  boxShadow: canSubmit ? "0 8px 20px -8px rgba(43,191,170,.6)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {submitting && <Loader2 className="h-[18px] w-[18px] animate-spin" />}
                {t("quickLessonDialog.createLessonBtn")}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <QuickAddStudentDialog
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        onCreated={() => setReloadTrigger(n => n + 1)}
      />
    </>
  );
}
