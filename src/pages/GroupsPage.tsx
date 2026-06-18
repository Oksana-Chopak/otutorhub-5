import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { PageFAB } from "@/components/PageFAB";
import { GroupsSkeleton } from "@/components/PageSkeletons";
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
import { Loader2, Plus, Trash2, Users2, UserPlus, Archive, Menu,
} from "lucide-react";
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
          m.set(p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("shared.student"));
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
      <div>
        <div className="mb-6 hidden lg:flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">{t("groupsPage.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("groupsPage.subtitle")}
            </p>
          </div>
          <NotificationBell />
        </div>

        {loading ? (
          <GroupsSkeleton />
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
                className="text-left transition-shadow hover:shadow-md"
                style={{ borderRadius: 18, border: "1px solid #eceef3", background: "#fff", padding: 14, cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 46, height: 46, borderRadius: 999, flexShrink: 0, background: "rgba(43,191,170,.12)", color: "#1f8e7e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Users2 size={22} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3 style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 16, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</h3>
                    {g.subject && (
                      <p style={{ fontSize: 13.5, color: "#6b7088", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.subject}</p>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, background: "#f0fdf9", color: "#1f8e7e", boxShadow: "inset 0 0 0 1px rgba(43,191,170,.3)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13 }}>
                  👥 {t("groupsPage.membersCount", { count: enrollCountFor(g.id) })}
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
      <PageFAB onClick={() => setCreateOpen(true)} label={t("groupsPageExtra.newGroupFab")} />
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
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("shared.tutor"),
        }))
      );
    })();
  }, [isManager, open]);

  const submit = async () => {
    if (!user || !name.trim()) {
      toast.error(t("groupsPage.nameRequired") ?? t("groupsPageExtra.nameRequiredFallback"));
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groupsPageExtra.namePlaceholder")} />
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
            {t("groupsPageExtra.cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("groupsPageExtra.create")}
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
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
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
    const enrolledIds = new Set((ens ?? []).filter((e: any) => e.status === "active").map((e: any) => e.student_id));
    const candidateIds = new Set<string>();
    if (isManager) {
      // MANAGER: a group is a hub teaching unit — any of the hub's students can be
      // added (enrolling them in the group IS the act of putting them in this
      // tutor's class). Restricting to students already individually assigned to the
      // group's tutor made it impossible to build a brand-new group, which is the
      // reported bug. Source of truth = the same student set People shows:
      // user_roles(role='student'); profiles RLS keeps it scoped to the hub.
      const { data: studentRoleRows } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "student");
      (studentRoleRows ?? []).forEach((r: any) => candidateIds.add(r.user_id));
    } else {
      // INDEPENDENT TUTOR: only their own students (via lesson OR rate).
      // Джерело істини — tutor_student_pairs (учень репетитора через урок АБО ставку),
      // фолбек на student_rates про всяк випадок.
      const [{ data: pairs }, { data: rates }] = await Promise.all([
        supabase.from("tutor_student_pairs").select("student_id").eq("tutor_id", groupTutorId),
        supabase.from("student_rates").select("student_id, archived_at").eq("tutor_id", groupTutorId),
      ]);
      (pairs ?? []).forEach((p: any) => candidateIds.add(p.student_id));
      (rates ?? []).forEach((r: any) => { if (!r.archived_at) candidateIds.add(r.student_id); });
    }
    const ids = Array.from(candidateIds).filter((sid) => !enrolledIds.has(sid));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      setAvailable(
        (profs ?? []).map((p: any) => ({
          student_id: p.id,
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("shared.student"),
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
      // Перетворюємо технічні помилки БД на зрозумілі.
      const code = (error as any).code;
      const msg = error.message || "";
      if (code === "23505" || /duplicate|unique/i.test(msg)) {
        // Учень уже був у групі (можливо неактивний) — реактивуємо.
        const { error: upErr } = await supabase
          .from("group_enrollments")
          .update({ status: "active" })
          .eq("group_id", groupId)
          .eq("student_id", pickedStudent);
        if (upErr) {
          toast.error(upErr.message);
          return;
        }
        setPickedStudent("");
        toast.success(t("groupsPageExtra.studentAdded"));
        load();
        onChanged();
        return;
      }
      if (code === "42501" || /permission denied|policy|row-level/i.test(msg)) {
        toast.error(t("groupsPageExtra.addStudentNoAccess"));
        return;
      }
      toast.error(msg || t("groupsPageExtra.addStudentFailed"));
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
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
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
            {t("groupsPageExtra.deleteGroup")}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t("groupsPageExtra.doneBtn")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
