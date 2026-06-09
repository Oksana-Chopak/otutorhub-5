import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertNotification } from "@/lib/notifications";
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
import { Loader2, Pencil, Plus, User, Users2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncLessonToGoogleCalendar } from "@/lib/googleCalendarSync";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";
import i18nInstance from "@/i18n";
import { useTranslation } from "react-i18next";
const t = i18nInstance.t.bind(i18nInstance);

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

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: rates }, { data: gs }] = await Promise.all([
        supabase
          .from("student_rates")
          .select("student_id, subject, price_per_lesson, archived_at")
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
            `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень",
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

  const submit = async () => {
    if (!user || !startsAt) return;

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
      const lessonType: "pair" | "group" =
        selectedGroup.participants.length === 2 ? "pair" : "group";
      const subj = selectedGroup.subject || t("shared.lesson");
      const { data: created, error } = await supabase
        .from("lessons")
        .insert({
          tutor_id: user.id,
          student_id: null,
          group_id: selectedGroup.id,
          lesson_type: lessonType,
          subject: subj,
          starts_at: startsAt.toISOString(),
          duration_minutes: parseInt(duration) || 60,
          status: "scheduled" as const,
          created_by: user.id,
          source: "independent",
        } as any)
        .select("id")
        .single();
      if (error || !created) {
        setSubmitting(false);
        toast.error(error?.message || (t("schedule.createLessonFailed") ?? "Не вдалося створити урок"));
        return;
      }
      // Auto-create participants
      if (selectedGroup.participants.length) {
        await supabase.from("lesson_participants").insert(
          selectedGroup.participants.map((p) => ({
            lesson_id: created.id,
            student_id: p.student_id,
          })) as any
        );
      }
      setSubmitting(false);
      localStorage.setItem(LAST_MODE_KEY, "group");
      localStorage.setItem(LAST_GROUP_KEY, selectedGroup.id);
      toast.success(t("quickLessonDialogExtra.groupCreated", { name: selectedGroup.name }));
      void syncLessonToGoogleCalendar(created.id, "upsert");
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
    const lessonPayload = {
      tutor_id: user.id,
      student_id: selected.student_id,
      subject: selected.subject,
      starts_at: startsAt.toISOString(),
      duration_minutes: parseInt(duration) || 60,
      status: "scheduled" as const,
      created_by: user.id,
      source: "independent",
      meeting_url: selected.default_meeting_url || null,
    };
    const { data: created, error } = await supabase
      .from("lessons")
      .insert(lessonPayload)
      .select("id")
      .single();
    if (!error && created) {
      await supabase
        .from("lesson_details")
        .upsert(
          { lesson_id: created.id, student_price: selected.price || 0, tutor_payout: 0 } as any,
          { onConflict: "lesson_id" }
        );
    }
    setSubmitting(false);
    if (error) {
      console.error(error);
      toast.error(error.message || t("quickLessonDialogExtra.lessonCreateFailed"));
      return;
    }
    localStorage.setItem(LAST_KEY, selected.student_id);
    if (created) void syncLessonToGoogleCalendar(created.id, "upsert");
    // Notify student that a new lesson has been scheduled
    if (created && selected.student_id) {
      const dateStr = startsAt.toLocaleString("uk-UA", {
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      });
      insertNotification({
        userId: selected.student_id,
        type: `lesson_scheduled_${created.id}`,
        title: "📅 Новий урок у розкладі",
        body: `Репетитор запланував урок — ${dateStr}`,
        link: "/schedule",
      });
    }
    localStorage.setItem(LAST_MODE_KEY, "individual");
    toast.success(
      `${t("quickLessonDialogExtra.lessonCreated", { name: selected.name, time: startsAt.toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      }) })}`
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

  const canSubmit =
    !submitting && (mode === "individual" ? !!selected : !!selectedGroup);

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
        <DialogContent className="max-w-[440px] p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[86vh] overflow-y-auto">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-0">
            <div style={{ width: 38, height: 5, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
          </div>

          <div style={{ padding: "14px 20px 24px" }}>
            {/* Hero: date + time */}
            <div style={{ marginBottom: 18 }}>
              <p style={{ fontFamily: F.display, fontWeight: 800, fontSize: 21, color: F.txt, lineHeight: 1.2 }}>
                {timeLabel ?? "Новий урок"}
              </p>
              <p style={{ fontSize: 14, color: F.sub, marginTop: 3, fontFamily: F.body }}>
                Оберіть учня та тривалість
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <div className="animate-spin text-2xl">⟳</div>
              </div>
            ) : students.length === 0 && groups.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p style={{ fontSize: 14, color: F.sub, marginBottom: 12, fontFamily: F.body }}>
                  {t("quickLessonDialog.noStudentsHint")}
                </p>
                <button onClick={() => setAddStudentOpen(true)}
                  style={{ height: 44, padding: "0 20px", borderRadius: 12, border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff",
                    fontFamily: F.display, fontWeight: 700, fontSize: 14 }}>
                  + {t("quickLessonDialog.addStudentBtn")}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Mode toggle */}
                {groups.length > 0 && (
                  <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 13,
                    background: "rgba(15,15,26,.06)" }}>
                    {(["individual", "group"] as const).map(m => (
                      <button key={m} onClick={() => setMode(m)}
                        style={{ flex: 1, height: 38, borderRadius: 10, border: "none", cursor: "pointer",
                          background: mode === m ? F.surface : "transparent",
                          boxShadow: mode === m ? "0 1px 4px rgba(15,15,26,.12)" : "none",
                          fontFamily: F.display, fontWeight: 700, fontSize: 14,
                          color: mode === m ? F.tealD : F.muted }}>
                        {m === "individual" ? "👤 Індивідуальний" : "👥 Груповий"}
                      </button>
                    ))}
                  </div>
                )}

                {/* Student cards */}
                {mode === "individual" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
                    {students.map(s => {
                      const active = studentId === s.student_id;
                      return (
                        <button key={s.student_id} onClick={() => {
                            setStudentId(s.student_id);
                            localStorage.setItem(LAST_KEY, s.student_id);
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                            borderRadius: 16, textAlign: "left", cursor: "pointer",
                            border: active ? `1.5px solid ${F.teal}` : `1px solid ${F.border}`,
                            background: active ? F.tealL : F.surface,
                            boxShadow: active ? "0 0 0 1px rgba(43,191,170,.2)" : "0 1px 3px rgba(15,15,26,.05)" }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                            background: ava(s.name), display: "flex", alignItems: "center",
                            justifyContent: "center", fontFamily: F.display, fontWeight: 800, fontSize: 14, color: "#fff" }}>
                            {initials(s.name)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 15, color: F.txt,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {s.name}
                            </p>
                            <p style={{ fontSize: 13, color: F.sub, fontFamily: F.body }}>
                              {s.subject} · {s.price}{"₴"}/урок
                            </p>
                          </div>
                          {active && (
                            <div style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                              background: F.teal, display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#fff", fontSize: 13, fontWeight: 700 }}>✓</div>
                          )}
                        </button>
                      );
                    })}
                    <button onClick={() => setAddStudentOpen(true)}
                      style={{ height: 40, borderRadius: 12, border: `1px dashed ${F.border}`, cursor: "pointer",
                        background: "transparent", color: F.muted, fontFamily: F.body, fontSize: 14 }}>
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
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                            borderRadius: 16, textAlign: "left", cursor: "pointer",
                            border: active ? `1.5px solid ${F.teal}` : `1px solid ${F.border}`,
                            background: active ? F.tealL : F.surface }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                            background: ava(g.name), display: "flex", alignItems: "center",
                            justifyContent: "center", fontFamily: F.display, fontWeight: 800, fontSize: 14, color: "#fff" }}>
                            {initials(g.name)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 15, color: F.txt }}>
                              {g.name}
                            </p>
                            <p style={{ fontSize: 13, color: F.sub, fontFamily: F.body }}>
                              {g.subject} · {g.participants.length} уч.
                            </p>
                          </div>
                          {active && <div style={{ width: 22, height: 22, borderRadius: 999, background: F.teal,
                            display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>✓</div>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Duration chips */}
                <div>
                  <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, color: F.sub,
                    textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
                    Тривалість
                  </p>
                  <div style={{ display: "flex", gap: 7 }}>
                    {["30","45","60","90","120"].map(d => (
                      <button key={d} onClick={() => setDuration(d)}
                        style={{ flex: 1, height: 44, borderRadius: 12, cursor: "pointer",
                          border: duration === d ? `1.5px solid ${F.teal}` : `1px solid ${F.border}`,
                          background: duration === d ? F.tealL : F.surface,
                          fontFamily: F.display, fontWeight: 700, fontSize: 14,
                          color: duration === d ? F.tealD : F.sub }}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Summary line */}
                {(selected || selectedGroup) && (
                  <div style={{ padding: "10px 14px", borderRadius: 12, background: F.bg,
                    border: `1px solid ${F.border}`, fontSize: 14, color: F.sub, fontFamily: F.body }}>
                    {mode === "individual" && selected && (
                      <>
                        ✓ {selected.name} · {selected.subject} · {duration} хв · {selected.price}
₴
                        {selected?.default_meeting_url ? " · Zoom ✓" : ""}
                      </>
                    )}
                    {mode === "group" && selectedGroup && (
                      <>{selectedGroup.name} · {selectedGroup.subject} · {duration} хв · {selectedGroup.participants.length} уч.</>
                    )}
                  </div>
                )}

                {/* Submit + Open editor */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    disabled={submitting || !canSubmit}
                    onClick={submit}
                    style={{ width: "100%", height: 52, borderRadius: 14, border: "none",
                      cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
                      background: canSubmit ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "rgba(43,191,170,.35)",
                      color: "#fff", fontFamily: F.display, fontWeight: 700, fontSize: 16,
                      boxShadow: canSubmit ? "0 8px 20px -8px rgba(43,191,170,.55)" : "none",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    {submitting && <span className="animate-spin">⟳</span>}
                    Створити урок
                  </button>

                  {startsAt && onWantFullForm && mode === "individual" && (
                    <button onClick={() => { onOpenChange(false); onWantFullForm!(startsAt!); }}
                      style={{ width: "100%", height: 44, borderRadius: 12, cursor: "pointer",
                        border: `1px solid ${F.border}`, background: F.surface,
                        fontFamily: F.display, fontWeight: 600, fontSize: 14, color: F.muted }}>
                      Відкрити повний редактор →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
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
