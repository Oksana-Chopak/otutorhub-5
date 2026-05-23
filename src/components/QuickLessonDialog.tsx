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
import { Loader2, Pencil, Plus, User, Users2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncLessonToGoogleCalendar } from "@/lib/googleCalendarSync";
import { QuickAddStudentDialog } from "@/components/QuickAddStudentDialog";
import i18nInstance from "@/i18n";
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
      let participantsByGroup = new Map<string, { student_id: string }[]>();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("quickLessonDialogExtra.title")}</DialogTitle>
          <DialogDescription>{timeLabel}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : students.length === 0 && groups.length === 0 ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              {t("quickLessonDialog.noStudentsHint")}
            </p>
            <Button size="sm" onClick={() => setAddStudentOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("quickLessonDialog.addStudentBtn")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Type toggle */}
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setMode("individual")}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === "individual"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                <User className="h-3.5 w-3.5" />
                {t("quickLessonDialog.modeIndividual")}
              </button>
              <button
                type="button"
                onClick={() => setMode("group")}
                disabled={groups.length === 0}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                  mode === "group"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                <Users2 className="h-3.5 w-3.5" />
                {t("quickLessonDialog.modeGroup")}
              </button>
            </div>

            {mode === "individual" ? (
              <div className="space-y-1">
                <Label>{t("quickLessonDialogExtra.studentLabel")}</Label>
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
            ) : (
              <div className="space-y-1">
                <Label>{t("quickLessonDialogExtra.groupLabel")}</Label>
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("quickLessonDialogExtra.selectGroup")} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} · {t("quickLessonDialog.participantsCount", { count: g.participants.length })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>{t("quickLessonDialogExtra.durationLabel")}</Label>
              <Input
                type="number"
                min={15}
                step={15}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            {mode === "individual" && selected && (
              <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                {selected.subject || t("quickLessonDialogExtra.noSubject")} · {selected.price || 0} ₴
                {selected.default_meeting_url ? " · Zoom/Meet ✓" : ""}
              </p>
            )}
            {mode === "group" && selectedGroup && (
              <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                {selectedGroup.subject || t("quickLessonDialogExtra.noSubject")} · {selectedGroup.participants.length} учасників
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {startsAt && onWantFullForm && mode === "individual" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onWantFullForm(startsAt);
              }}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t("quickLessonDialog.detailsBtn")}
            </Button>
          )}
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("quickLessonDialog.createBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <QuickAddStudentDialog
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        onCreated={() => {
          setAddStudentOpen(false);
          setReloadTrigger((n) => n + 1);
        }}
      />
    </Dialog>
  );
}
