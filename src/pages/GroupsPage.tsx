import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubjectSelect } from "@/components/SubjectSelect";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Users2, UserPlus, Archive } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface Group {
  id: string;
  tutor_id: string;
  name: string;
  subject: string | null;
  subject_id: string | null;
  created_at: string;
}

interface TutorOption {
  id: string;
  name: string;
}

interface Enrollment {
  id: string;
  group_id: string;
  student_id: string;
  status: "active" | "inactive";
}

interface StudentOption {
  student_id: string;
  name: string;
}

export default function GroupsPage() {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [studentNames, setStudentNames] = useState<Map<string, string>>(new Map());
  const [createOpen, setCreateOpen] = useState(false);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    let q = supabase.from("lesson_groups").select("*").order("created_at", { ascending: false });
    if (!isManager) q = q.eq("tutor_id", user.id);
    const { data: gs, error } = await q;
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setGroups((gs ?? []) as Group[]);

    const groupIds = (gs ?? []).map((g: any) => g.id);
    if (groupIds.length) {
      const { data: ens } = await supabase
        .from("group_enrollments")
        .select("id, group_id, student_id, status")
        .in("group_id", groupIds);
      setEnrollments((ens ?? []) as Enrollment[]);
      const studentIds = Array.from(new Set((ens ?? []).map((e: any) => e.student_id)));
      if (studentIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", studentIds);
        const m = new Map<string, string>();
        (profs ?? []).forEach((p: any) => {
          m.set(p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень");
        });
        setStudentNames(m);
      } else {
        setStudentNames(new Map());
      }
    } else {
      setEnrollments([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const enrollCountFor = (gid: string) =>
    enrollments.filter((e) => e.group_id === gid && e.status === "active").length;

  return (
    <AppLayout>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">{t("groupsPage.title")}</h1>
            <p className="text-sm text-muted-foreground">
              Об'єднуйте учнів у групи для парних та групових уроків
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Нова група
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Users2}
            title={t("groupsPage.noGroups")}
            description={t("groupsPage.noGroupsDesc")}
            actionLabel={t("groupsPage.createGroup")}
            onAction={() => setCreateOpen(true)}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setDetailGroupId(g.id)}
                className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-foreground">{g.name}</h3>
                    {g.subject && (
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{g.subject}</p>
                    )}
                  </div>
                  <Users2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
                  {enrollCountFor(g.id)} учнів
                </div>
              </button>
            ))}
          </div>
        )}

        <CreateGroupDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />

        {detailGroupId && (
          <GroupDetailsDialog
            groupId={detailGroupId}
            onOpenChange={(o) => !o && setDetailGroupId(null)}
            studentNames={studentNames}
            onChanged={load}
          />
        )}
      </div>
    </AppLayout>
  );
}

function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [tutorId, setTutorId] = useState<string>("");
  const [tutors, setTutors] = useState<TutorOption[]>([]);

  useEffect(() => {
    if (!isManager || !open) return;
    (async () => {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "tutor");
      const ids = Array.from(new Set((roleRows ?? []).map((r: any) => r.user_id)));
      if (!ids.length) {
        setTutors([]);
        return;
      }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      setTutors(
        (profs ?? []).map((p: any) => ({
          id: p.id,
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Репетитор",
        }))
      );
    })();
  }, [isManager, open]);

  const submit = async () => {
    if (!user || !name.trim()) {
      toast.error(t("groupsPage.nameRequired") ?? "Вкажіть назву групи");
      return;
    }
    if (isManager && !tutorId) {
      toast.error(t("groupsPageExtra.selectTutorRequired"));
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("lesson_groups").insert({
      tutor_id: isManager ? tutorId : user.id,
      name: name.trim(),
      subject: subject || null,
      subject_id: subjectId || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setName("");
    setSubject("");
    setSubjectId(undefined);
    setTutorId("");
    toast.success(t("groupsPageExtra.created"));
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("groupsPageExtra.newGroupTitle")}</DialogTitle>
          <DialogDescription>{t("groupsPageExtra.newGroupDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isManager && (
            <div className="space-y-1">
              <Label>{t("groupsPageExtra.tutorLabel")}</Label>
              <Select value={tutorId} onValueChange={setTutorId}>
                <SelectTrigger>
                  <SelectValue placeholder={tutors.length ? t("groupsPageExtra.selectTutor") : t("groupsPageExtra.noTutors")} />
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
          )}
          <div className="space-y-1">
            <Label>{t("groupsPageExtra.nameLabel")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Наприклад: Англійська · 9-Б" />
          </div>
          <div className="space-y-1">
            <Label>{t("groupsPageExtra.subjectLabel")}</Label>
            <SubjectSelect
              value={subject}
              onValueChange={(name, id) => {
                setSubject(name);
                setSubjectId(id);
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Створити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupDetailsDialog({
  groupId,
  onOpenChange,
  studentNames,
  onChanged,
}: {
  groupId: string;
  onOpenChange: (v: boolean) => void;
  studentNames: Map<string, string>;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [available, setAvailable] = useState<StudentOption[]>([]);
  const [pickedStudent, setPickedStudent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: g }, { data: ens }] = await Promise.all([
      supabase.from("lesson_groups").select("*").eq("id", groupId).maybeSingle(),
      supabase.from("group_enrollments").select("id, group_id, student_id, status").eq("group_id", groupId),
    ]);
    setGroup(g as Group);
    setEnrollments((ens ?? []) as Enrollment[]);

    const groupTutorId = (g as any)?.tutor_id ?? user.id;
    // available = tutor's students not already enrolled (active)
    const enrolledIds = new Set((ens ?? []).filter((e: any) => e.status === "active").map((e: any) => e.student_id));
    const { data: rates } = await supabase
      .from("student_rates")
      .select("student_id, archived_at")
      .eq("tutor_id", groupTutorId);
    const ids = Array.from(
      new Set(
        (rates ?? [])
          .filter((r: any) => !r.archived_at && !enrolledIds.has(r.student_id))
          .map((r: any) => r.student_id)
      )
    );
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      setAvailable(
        (profs ?? []).map((p: any) => ({
          student_id: p.id,
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень",
        }))
      );
    } else {
      setAvailable([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [groupId]);

  const addStudent = async () => {
    if (!pickedStudent) return;
    setBusy(true);
    const { error } = await supabase.from("group_enrollments").insert({
      group_id: groupId,
      student_id: pickedStudent,
      status: "active",
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPickedStudent("");
    toast.success(t("groupsPageExtra.studentAdded"));
    load();
    onChanged();
  };

  const removeStudent = async (enrollmentId: string) => {
    setBusy(true);
    const { error } = await supabase.from("group_enrollments").delete().eq("id", enrollmentId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("groupsPageExtra.studentRemoved"));
    load();
    onChanged();
  };

  const archiveGroup = async () => {
    if (!confirm(t("groupsPageExtra.confirmDelete"))) return;
    const { error } = await supabase.from("lesson_groups").delete().eq("id", groupId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("groupsPageExtra.deleted"));
    onChanged();
    onOpenChange(false);
  };

  const active = enrollments.filter((e) => e.status === "active");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{group?.name ?? t("groupsPageExtra.groupFallback")}</DialogTitle>
          {group?.subject && <DialogDescription>{group.subject}</DialogDescription>}
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-semibold">{t("groupsPageExtra.members", { count: active.length })}</h4>
              {active.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("groupsPageExtra.noMembers")}</p>
              ) : (
                <ul className="space-y-1">
                  {active.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span>{studentNames.get(e.student_id) ?? t("shared.student")}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeStudent(e.id)}
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1">
              <Label>{t("groupsPageExtra.addStudentLabel")}</Label>
              <div className="flex gap-2">
                <Select value={pickedStudent} onValueChange={setPickedStudent}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={available.length ? t("shared.student") : t("groupsPageExtra.noStudents")} />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((s) => (
                      <SelectItem key={s.student_id} value={s.student_id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={addStudent} disabled={!pickedStudent || busy}>
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={archiveGroup} className="text-destructive">
            <Archive className="mr-2 h-4 w-4" />
            Видалити групу
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t("groupsPageExtra.doneBtn")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
