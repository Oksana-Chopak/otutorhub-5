import { useEffect, useState, type ReactNode } from "react";
import { PageFAB } from "@/components/PageFAB";
import { GroupsSkeleton } from "@/components/PageSkeletons";
import { AppLayout } from "@/components/AppLayout";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { SubjectSelect } from "@/components/SubjectSelect";
import { InviteLinkDialog } from "@/components/InviteLinkDialog";
import { useSubjects } from "@/hooks/useSubjects";
import { currencySymbol } from "@/lib/currency";
import { createGroupLesson } from "@/lib/groupLessons";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, Users2, Check, ChevronRight, X, Search, CalendarClock,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

// ── Design tokens (match the approved handoff; inline like the references) ───
const T = {
  teal: "#2BBFAA",
  tealD: "#25a896",
  txt: "#0f0f1a",
  sub: "#6b7088",
  muted: "#b0b4c8",
  border: "#eceef3",
  bg: "#F5F4F0",
  gold: "#9a6a12",
  coral: "#e0552f",
  tealL: "var(--teal-l, #f0fdf9)",
};
const GRAD_TEAL = "linear-gradient(135deg,#2BBFAA,#25a896)";
const GRAD_DARK = "linear-gradient(135deg,#0f0f1a,#1a1a3e)";
const SHADOW_TEAL = "0 6px 16px -6px rgba(43,191,170,.7)";
const SHADOW_SM = "0 1px 2px rgba(15,15,26,.05)";
const FONT_D = "Inter, system-ui, sans-serif";
const FONT_B = "Inter, system-ui, sans-serif";

const AVC = ["#2BBFAA", "#5b6bf5", "#FF7A59", "#F59E0B", "#8B5CF6"];
const initials = (n: string) =>
  n.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "•";
const avColor = (n: string) => AVC[((n.charCodeAt(0) || 0) + (n.charCodeAt(1) || 0)) % AVC.length];

function Avatar({ name, size = 46 }: { name: string; size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 999, flexShrink: 0,
        background: avColor(name), color: "#fff", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: FONT_D, fontWeight: 800, fontSize: Math.max(14, Math.round(size * 0.34)),
      }}
    >
      {initials(name)}
    </div>
  );
}

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
  price_per_lesson: number | null;
  currency: string;
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
        .select("id, group_id, student_id, status, price_per_lesson, currency")
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
          {/* Desktop bell now comes from AppLayout (one global fixed bell) */}
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
                      <p style={{ fontSize: 15, color: "var(--sub,#6b7088)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.subject}</p>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, background: "#f0fdf9", color: "#1f8e7e", boxShadow: "inset 0 0 0 1px rgba(43,191,170,.3)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14 }}>
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
            load();
          }}
          onClose={() => setCreateOpen(false)}
          onOpenGroup={(gid) => {
            setCreateOpen(false);
            setDetailGroupId(gid);
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
  onClose,
  onOpenGroup,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  onClose: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const { user, roles } = useAuth();
  const isManager = roles.includes("manager");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [tutorId, setTutorId] = useState<string>("");
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  // Wizard-only presentation state (does not touch the create logic / Supabase).
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [tutorQuery, setTutorQuery] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const { subjects } = useSubjects();

  // Reset the wizard whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setStep(0);
      setDone(false);
      setCreatedGroupId(null);
      setTutorQuery("");
      setCustomSubject("");
    }
  }, [open]);

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
    const { data: created, error } = await supabase
      .from("lesson_groups")
      .insert({
        tutor_id: isManager ? tutorId : user.id,
        name: name.trim(),
        subject: subject || null,
        subject_id: subjectId || null,
      })
      .select("id")
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCreatedGroupId((created as { id: string } | null)?.id ?? null);
    toast.success(t("groupsPageExtra.created"));
    onCreated();
    setDone(true);
  };

  // Steps: name → (tutor for manager only) → subject.
  const steps: ("name" | "tutor" | "subject")[] = isManager
    ? ["name", "tutor", "subject"]
    : ["name", "subject"];
  const cur = steps[step];
  const lastStep = step >= steps.length - 1;
  const canNext = cur === "name" ? !!name.trim() : cur === "tutor" ? !!tutorId : true;
  const canCreate = !!name.trim() && (!isManager || !!tutorId);

  const filteredTutors = tutors.filter(
    (tu) => !tutorQuery.trim() || tu.name.toLowerCase().includes(tutorQuery.trim().toLowerCase())
  );

  const resetAndClose = () => {
    setName("");
    setSubject("");
    setSubjectId(undefined);
    setTutorId("");
    onClose();
  };

  const stepTitle =
    cur === "name" ? t("groupsPageExtra.stepNameTitle")
      : cur === "tutor" ? t("groupsPageExtra.stepTutorTitle")
        : t("groupsPageExtra.stepSubjectTitle");
  const stepDesc =
    cur === "name" ? t("groupsPageExtra.stepNameDesc")
      : cur === "tutor" ? t("groupsPageExtra.stepTutorDesc")
        : t("groupsPageExtra.stepSubjectDesc");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 rounded-t-[24px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto [&>button.absolute]:hidden">
        {done ? (
          /* ── Success screen ───────────────────────────────────────────── */
          <div style={{ display: "flex", flexDirection: "column", background: "#fff", fontFamily: FONT_B, color: T.txt }}>
            <div
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "40px 28px 28px", textAlign: "center",
                background: "radial-gradient(120% 80% at 50% 0%, #f0fdf9, #fff 70%)",
              }}
            >
              <div style={{ fontSize: 64 }}>🎉</div>
              <div style={{ fontFamily: FONT_D, fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", marginTop: 12 }}>
                {t("groupsPageExtra.createdTitle")}
              </div>
              <div style={{ fontFamily: FONT_B, fontSize: 16, color: T.sub, marginTop: 10, lineHeight: 1.5, maxWidth: 320 }}>
                {t("groupsPageExtra.createdDesc", { name: name.trim() })}
              </div>
            </div>
            <div style={{ flexShrink: 0, padding: "10px 22px 24px", display: "flex", flexDirection: "column", gap: 11 }}>
              <button
                onClick={() => {
                  const gid = createdGroupId;
                  resetAndClose();
                  if (gid) onOpenGroup(gid);
                }}
                disabled={!createdGroupId}
                style={{
                  width: "100%", minHeight: 58, borderRadius: 16, border: "none",
                  cursor: createdGroupId ? "pointer" : "not-allowed",
                  background: createdGroupId ? GRAD_TEAL : "#e7e9ef",
                  color: createdGroupId ? "#fff" : T.muted,
                  fontFamily: FONT_D, fontWeight: 800, fontSize: 18,
                  boxShadow: createdGroupId ? SHADOW_TEAL : "none",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
                }}
              >
                <Plus size={22} strokeWidth={2.5} />
                {t("groupsPageExtra.addStudentsCta")}
              </button>
              <button
                onClick={resetAndClose}
                style={{
                  width: "100%", minHeight: 50, borderRadius: 16, border: "none",
                  background: "transparent", color: T.sub, fontFamily: FONT_D,
                  fontWeight: 700, fontSize: 16, cursor: "pointer",
                }}
              >
                {t("groupsPageExtra.later")}
              </button>
            </div>
          </div>
        ) : (
          /* ── Step wizard ──────────────────────────────────────────────── */
          <div style={{ display: "flex", flexDirection: "column", maxHeight: "85vh", background: "#fff", fontFamily: FONT_B, color: T.txt }}>
            {/* header: back · progress · close */}
            <div style={{ flexShrink: 0, padding: "18px 20px 10px", display: "flex", alignItems: "center", gap: 12 }}>
              {step > 0 ? (
                <button
                  onClick={() => setStep(step - 1)}
                  aria-label={t("groupsPageExtra.back")}
                  style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: T.bg, cursor: "pointer", color: T.txt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <ChevronRight size={22} strokeWidth={2.2} style={{ transform: "rotate(180deg)" }} />
                </button>
              ) : (
                <div style={{ width: 44, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, display: "flex", gap: 6 }}>
                {steps.map((_, i) => (
                  <div key={i} style={{ flex: 1, height: 7, borderRadius: 999, background: i <= step ? T.teal : "rgba(15,15,26,.08)" }} />
                ))}
              </div>
              <button
                onClick={resetAndClose}
                aria-label={t("groupsPageExtra.close")}
                style={{ width: 44, height: 44, borderRadius: 12, border: "none", cursor: "pointer", background: T.bg, color: T.sub, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <X size={22} strokeWidth={2.2} />
              </button>
            </div>

            {/* step body (grows with content) */}
            <div style={{ overflowY: "auto", padding: "16px 22px 8px" }}>
              <div style={{ fontFamily: FONT_D, fontWeight: 800, fontSize: 26, letterSpacing: "-.02em", lineHeight: 1.15 }}>
                {stepTitle}
              </div>
              <div style={{ fontFamily: FONT_B, fontSize: 16, color: T.sub, margin: "10px 0 20px" }}>
                {stepDesc}
              </div>

              {cur === "name" && (
                <WizardField
                  value={name}
                  onChange={setName}
                  placeholder={t("groupsPageExtra.namePlaceholder")}
                  icon={<Users2 size={22} />}
                  big
                />
              )}

              {cur === "tutor" && (
                <div>
                  {tutors.length > 5 && (
                    <div style={{ marginBottom: 12 }}>
                      <WizardField
                        value={tutorQuery}
                        onChange={setTutorQuery}
                        placeholder={t("groupsPageExtra.tutorSearchPlaceholder")}
                        icon={<Search size={22} />}
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 11, maxHeight: 320, overflowY: "auto" }}>
                    {filteredTutors.map((tu) => {
                      const on = tutorId === tu.id;
                      return (
                        <button
                          key={tu.id}
                          onClick={() => setTutorId(tu.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 13, padding: 14, borderRadius: 16,
                            cursor: "pointer", border: `2px solid ${on ? T.teal : T.border}`,
                            background: on ? T.tealL : "#fff", flexShrink: 0,
                            boxShadow: on ? "none" : SHADOW_SM,
                          }}
                        >
                          <Avatar name={tu.name} size={48} />
                          <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                            <div style={{ fontFamily: FONT_D, fontWeight: 700, fontSize: 17, color: T.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tu.name}</div>
                          </div>
                          {on && <Check size={24} strokeWidth={2.5} style={{ color: T.tealD, flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                    {filteredTutors.length === 0 && (
                      <div style={{ fontFamily: FONT_B, fontSize: 16, color: T.muted, textAlign: "center", padding: "24px 0" }}>
                        {tutors.length === 0 ? t("groupsPageExtra.noTutors") : t("groupsPageExtra.noTutorsFound")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {cur === "subject" && (
                <div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 11, marginBottom: 14 }}>
                    {subjects.map((sj) => {
                      const on = subject === sj.name && !customSubject;
                      return (
                        <button
                          key={sj.id}
                          onClick={() => {
                            const next = on ? "" : sj.name;
                            setSubject(next);
                            setSubjectId(on ? undefined : sj.id);
                            setCustomSubject("");
                          }}
                          style={{
                            minHeight: 52, padding: "0 18px", borderRadius: 15, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", gap: 8, fontFamily: FONT_D,
                            fontWeight: 700, fontSize: 16,
                            background: on ? T.tealL : "#fff", color: on ? T.tealD : T.txt,
                            border: `2px solid ${on ? T.teal : T.border}`,
                            boxShadow: on ? "none" : SHADOW_SM,
                          }}
                        >
                          {sj.emoji && <span style={{ fontSize: 18 }}>{sj.emoji}</span>}
                          {sj.name}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontFamily: FONT_D, fontWeight: 700, fontSize: 14, color: T.muted, marginBottom: 8 }}>
                    {t("groupsPageExtra.customSubjectLabel")}
                  </div>
                  <WizardField
                    value={customSubject}
                    onChange={(v) => {
                      setCustomSubject(v);
                      setSubject(v);
                      setSubjectId(undefined);
                    }}
                    placeholder={t("groupsPageExtra.customSubjectPlaceholder")}
                    icon={<Plus size={22} />}
                  />
                </div>
              )}
            </div>

            {/* footer: Next / Create */}
            <div style={{ flexShrink: 0, padding: "16px 22px 22px", borderTop: `1px solid ${T.border}` }}>
              {!lastStep ? (
                <button
                  disabled={!canNext}
                  onClick={() => canNext && setStep(step + 1)}
                  style={{
                    width: "100%", minHeight: 58, borderRadius: 16, border: "none",
                    cursor: canNext ? "pointer" : "not-allowed",
                    background: canNext ? GRAD_TEAL : "#e7e9ef",
                    color: canNext ? "#fff" : T.muted,
                    fontFamily: FONT_D, fontWeight: 800, fontSize: 18,
                    boxShadow: canNext ? SHADOW_TEAL : "none",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {t("groupsPageExtra.next")}
                  <ChevronRight size={21} strokeWidth={2.4} />
                </button>
              ) : (
                <button
                  disabled={!canCreate || submitting}
                  onClick={submit}
                  style={{
                    width: "100%", minHeight: 58, borderRadius: 16, border: "none",
                    cursor: canCreate && !submitting ? "pointer" : "not-allowed",
                    background: canCreate ? GRAD_TEAL : "#e7e9ef",
                    color: canCreate ? "#fff" : T.muted,
                    fontFamily: FONT_D, fontWeight: 800, fontSize: 18,
                    boxShadow: canCreate ? SHADOW_TEAL : "none",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
                  }}
                >
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check size={22} strokeWidth={2.5} />}
                  {t("groupsPageExtra.create")}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Big rounded text field matching the handoff (focus ring + teal border).
function WizardField({
  value, onChange, placeholder, icon, big,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  big?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 11,
        minHeight: big ? 64 : 58, borderRadius: 16, padding: "0 18px",
        background: focused ? "#fff" : "#fbfbfc",
        border: `2px solid ${focused ? T.teal : T.border}`,
        boxShadow: focused ? "0 0 0 4px rgba(43,191,170,.13)" : "none",
        transition: "all .15s",
      }}
    >
      {icon && (
        <span style={{ color: focused ? T.tealD : T.muted, flexShrink: 0, display: "inline-flex" }}>
          {icon}
        </span>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
          fontFamily: big ? FONT_D : FONT_B, fontWeight: big ? 700 : 400,
          fontSize: big ? 20 : 17, color: T.txt,
        }}
      />
    </div>
  );
}

// Inline-editable price pill: gold "Ціна?" when null, teal "₴N" otherwise.
function PricePill({
  value, currency, onSave,
}: {
  value: number | null;
  currency: string;
  onSave: (raw: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value != null ? String(value) : "");
  useEffect(() => {
    if (!edit) setV(value != null ? String(value) : "");
  }, [value, edit]);

  if (edit) {
    return (
      <div
        style={{
          display: "inline-flex", alignItems: "center", height: 44, padding: "0 12px",
          borderRadius: 12, background: "#fff", border: `2px solid ${T.teal}`,
          boxShadow: "0 0 0 3px rgba(43,191,170,.13)", flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: FONT_D, fontWeight: 800, fontSize: 16, color: T.muted, marginRight: 4 }}>
          {currencySymbol(currency || "UAH")}
        </span>
        <input
          autoFocus
          inputMode="decimal"
          value={v}
          onChange={(e) => setV(e.target.value.replace(/[^\d.,]/g, ""))}
          onBlur={() => { onSave(v); setEdit(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { onSave(v); setEdit(false); } }}
          style={{ width: 56, border: "none", outline: "none", background: "transparent", fontFamily: FONT_D, fontWeight: 800, fontSize: 17, color: T.txt }}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEdit(true)}
      style={{
        flexShrink: 0, minHeight: 44, padding: "0 15px", borderRadius: 12, border: "none",
        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
        fontFamily: FONT_D, fontWeight: 800, fontSize: 16,
        background: value != null ? "rgba(43,191,170,.12)" : "rgba(245,181,68,.18)",
        color: value != null ? T.tealD : T.gold,
      }}
    >
      {value != null ? `${currencySymbol(currency || "UAH")}${value}` : t("groupsPageExtra.setPrice")}
    </button>
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
  // Independence decides group-lesson source: ONLY a truly independent tutor's group
  // lesson is "independent". A HUB tutor (not manager, not independent) must stamp "hub"
  // so the lesson stays visible to the manager — `isManager` alone missed that case.
  const { isIndependent } = useWorkspaceSettings();
  const [group, setGroup] = useState<Group | null>(null);
  const [tutorName, setTutorName] = useState<string>("");
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [available, setAvailable] = useState<StudentOption[]>([]);
  // true = the tutor/hub has NO students at all (vs. all students already enrolled) —
  // lets the picker show the right empty message instead of a misleading "all in group".
  const [noStudentsAtAll, setNoStudentsAtAll] = useState(false);
  const [pickedStudent, setPickedStudent] = useState<string>("");
  const [pickedPrice, setPickedPrice] = useState<string>("");
  const [pickOpen, setPickOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Each student in a group has their OWN price (owner decision). Persisted on
  // group_enrollments.price_per_lesson; snapshotted onto lesson_participants when a
  // group lesson is scheduled.
  const saveEnrollmentPrice = async (enrollmentId: string, priceStr: string) => {
    const price = priceStr.trim() === "" ? null : Number(priceStr.replace(",", "."));
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      toast.error(t("groupsPageExtra.priceInvalid"));
      return;
    }
    // Group price = hub revenue (or the independent tutor's own) — write goes
    // through the gated RPC; direct column UPDATE revoked since 20260719000000.
    const { error } = await (supabase.rpc as any)("set_group_enrollment_price", {
      _enrollment_id: enrollmentId,
      _price: price,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("groupsPageExtra.priceSaved"));
    load();
  };

  // Schedule a group lesson straight from the group (works for every role: the
  // lesson's tutor = the group's tutor; source = "independent" ONLY for an independent
  // tutor, otherwise "hub" — so a hub tutor's lesson stays visible to the manager).
  // Snapshots each student's price + notifies them via the helper.
  const defaultStart = (() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [schedStart, setSchedStart] = useState<string>(defaultStart);
  const [schedDuration, setSchedDuration] = useState<string>("60");
  const [scheduling, setScheduling] = useState(false);

  const scheduleGroupLesson = async () => {
    if (!user || !group) return;
    if (active.length === 0) {
      toast.error(t("groupsPageExtra.scheduleNoMembers"));
      return;
    }
    if (!schedStart) {
      toast.error(t("groupsPageExtra.scheduleNoTime"));
      return;
    }
    setScheduling(true);
    const { lessonId, error } = await createGroupLesson({
      tutorId: group.tutor_id,
      groupId,
      subject: group.subject || t("shared.lesson"),
      startsAt: new Date(schedStart).toISOString(),
      durationMinutes: parseInt(schedDuration, 10) || 60,
      // Only an independent tutor's group lesson is "independent". Hub tutors AND
      // managers stamp "hub" so the manager keeps seeing the lesson.
      source: isIndependent ? "independent" : "hub",
      createdBy: user.id,
    });
    setScheduling(false);
    if (error || !lessonId) {
      toast.error(error || t("groupsPageExtra.scheduleFailed"));
      return;
    }
    toast.success(t("groupsPageExtra.scheduled", { count: active.length }));
    onChanged();
  };

  // When a not-yet-registered (ghost) student is enrolled, surface the invite so
  // they actually get onto the platform and can see the group lesson.
  const [invite, setInvite] = useState<{ open: boolean; name: string; email: string | null; phone: string | null; studentId: string } | null>(null);

  const maybeInviteGhost = async (studentId: string, name: string) => {
    const [{ data: prof }, { data: contact }] = await Promise.all([
      supabase.from("profiles").select("is_pending").eq("id", studentId).maybeSingle(),
      supabase.from("profile_contacts").select("email, phone").eq("user_id", studentId).maybeSingle(),
    ]);
    if ((prof as { is_pending?: boolean } | null)?.is_pending) {
      setInvite({ open: true, name, email: (contact as any)?.email ?? null, phone: (contact as any)?.phone ?? null, studentId });
    }
  };

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: g }, { data: ens }] = await Promise.all([
      supabase.from("lesson_groups").select("*").eq("id", groupId).maybeSingle(),
      supabase.from("group_enrollments").select("id, group_id, student_id, status, price_per_lesson, currency").eq("group_id", groupId),
    ]);
    setGroup(g as Group);
    setEnrollments((ens ?? []) as Enrollment[]);

    const groupTutorId = (g as any)?.tutor_id ?? user.id;

    // Resolve the group tutor's display name for the header subtitle.
    if (groupTutorId) {
      const { data: tutorProf } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", groupTutorId)
        .maybeSingle();
      const tn = `${(tutorProf as any)?.first_name ?? ""} ${(tutorProf as any)?.last_name ?? ""}`.trim();
      setTutorName(tn || t("shared.tutor"));
    }

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
    setNoStudentsAtAll(candidateIds.size === 0);
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

  // Enroll a chosen available student. Price is set afterwards on the member's
  // pill (null price is fine on enroll). Mirrors the old addStudent logic exactly,
  // just sourced from a clicked row instead of the select/price inputs.
  const addStudentById = async (studentId: string) => {
    if (!studentId) return;
    const picked = studentId;
    const pickedName = available.find((s) => s.student_id === picked)?.name ?? t("shared.student");
    const priceVal = pickedPrice.trim() === "" ? null : Number(pickedPrice.replace(",", "."));
    if (priceVal !== null && (!Number.isFinite(priceVal) || priceVal < 0)) {
      toast.error(t("groupsPageExtra.priceInvalid"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("group_enrollments").insert({
      group_id: groupId,
      student_id: picked,
      status: "active",
      price_per_lesson: priceVal,
    });
    setBusy(false);
    if (error) {
      // Перетворюємо технічні помилки БД на зрозумілі.
      const code = (error as any).code;
      const msg = error.message || "";
      if (code === "23505" || /duplicate|unique/i.test(msg)) {
        // Учень уже був у групі (можливо неактивний) — реактивуємо.
        // Price is a gated money column (20260719000000): status flips directly,
        // the price goes through the RPC (only when one was actually entered).
        const { error: upErr } = await supabase
          .from("group_enrollments")
          .update({ status: "active" })
          .eq("group_id", groupId)
          .eq("student_id", picked);
        if (upErr) {
          toast.error(upErr.message);
          return;
        }
        if (priceVal !== null) {
          const { data: enr } = await supabase
            .from("group_enrollments")
            .select("id")
            .eq("group_id", groupId)
            .eq("student_id", picked)
            .maybeSingle();
          if (enr?.id) {
            await (supabase.rpc as any)("set_group_enrollment_price", { _enrollment_id: enr.id, _price: priceVal });
          }
        }
        setPickedStudent("");
        setPickedPrice("");
        toast.success(t("groupsPageExtra.studentAdded"));
        void maybeInviteGhost(picked, pickedName);
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
    setPickedPrice("");
    toast.success(t("groupsPageExtra.studentAdded"));
    void maybeInviteGhost(picked, pickedName);
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
    if (!(await confirmDialog({ description: t("groupsPageExtra.confirmDelete"), destructive: true, confirmText: t("common.delete") }))) return;
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

  // Human-readable "date · time" for the scheduling row.
  const schedLabel = (() => {
    if (!schedStart) return t("groupsPageExtra.schedulePickDate");
    const d = new Date(schedStart);
    if (Number.isNaN(d.getTime())) return t("groupsPageExtra.schedulePickDate");
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0 rounded-t-[24px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto [&>button.absolute]:hidden">
          <div style={{ display: "flex", flexDirection: "column", maxHeight: "88vh", background: "#fff", fontFamily: FONT_B, color: T.txt }}>
            {/* header */}
            <div style={{ flexShrink: 0, padding: "20px 20px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 13 }}>
              <div style={{ width: 50, height: 50, borderRadius: 15, flexShrink: 0, background: GRAD_TEAL, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SHADOW_TEAL }}>
                <Users2 size={25} strokeWidth={2} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_D, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {group?.name ?? t("groupsPageExtra.groupFallback")}
                </div>
                {tutorName && (
                  <div style={{ fontFamily: FONT_B, fontSize: 15, color: T.sub, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t("groupsPageExtra.tutorPrefix", { name: tutorName })}
                  </div>
                )}
              </div>
              <button
                onClick={() => onOpenChange(false)}
                aria-label={t("groupsPageExtra.close")}
                style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: "none", cursor: "pointer", background: T.bg, color: T.sub, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <X size={20} strokeWidth={2.2} />
              </button>
            </div>

            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: T.muted }} />
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 26 }}>
                {/* members */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontFamily: FONT_D, fontWeight: 800, fontSize: 17, color: T.txt }}>{t("groupsPageExtra.membersShort")}</span>
                    <span style={{ fontFamily: FONT_D, fontWeight: 700, fontSize: 15, color: T.muted }}>{active.length}</span>
                  </div>
                  {active.length === 0 ? (
                    <div style={{ fontFamily: FONT_B, fontSize: 15, color: T.sub, padding: "8px 0" }}>{t("groupsPageExtra.noMembers")}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {active.map((e) => {
                        const nm = studentNames.get(e.student_id) ?? t("shared.student");
                        return (
                          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, border: `1px solid ${T.border}`, background: "#fff", boxShadow: SHADOW_SM }}>
                            <Avatar name={nm} size={46} />
                            <div style={{ flex: 1, minWidth: 0, fontFamily: FONT_D, fontWeight: 700, fontSize: 17, color: T.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nm}</div>
                            {/* MON-2: group price = hub money — visible/editable only for
                                hub-scoped managers and independent owner-tutors (server
                                enforces via set_group_enrollment_price + column lock). */}
                            {(isManager || isIndependent) && (
                              <PricePill
                                value={e.price_per_lesson}
                                currency={e.currency || "UAH"}
                                onSave={(raw) => saveEnrollmentPrice(e.id, raw)}
                              />
                            )}
                            <button
                              onClick={() => removeStudent(e.id)}
                              disabled={busy}
                              aria-label={t("common.delete")}
                              style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: "none", cursor: busy ? "not-allowed" : "pointer", background: "rgba(255,122,89,.1)", color: T.coral, display: "flex", alignItems: "center", justifyContent: "center" }}
                            >
                              <Trash2 size={20} strokeWidth={2} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ fontFamily: FONT_B, fontWeight: 600, fontSize: 15, color: "#4a5060", marginTop: 11 }}>
                    {t("groupsPageExtra.membersHint")}
                  </div>
                </div>

                {/* add student */}
                <div>
                  <button
                    onClick={() => setPickOpen((o) => !o)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                      width: "100%", minHeight: 58, borderRadius: 16, cursor: "pointer",
                      border: `2px dashed ${T.teal}`, background: T.tealL, color: T.tealD,
                      fontFamily: FONT_D, fontWeight: 700, fontSize: 17,
                    }}
                  >
                    <Plus size={22} strokeWidth={2.4} />
                    {t("groupsPageExtra.addStudentLabel")}
                  </button>
                  {pickOpen && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                      {available.map((s) => (
                        <div key={s.student_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 15, border: `1px solid ${T.border}`, background: "#fbfbfc" }}>
                          <Avatar name={s.name} size={42} />
                          <span style={{ flex: 1, minWidth: 0, fontFamily: FONT_D, fontWeight: 700, fontSize: 16, color: T.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                          <button
                            onClick={() => addStudentById(s.student_id)}
                            disabled={busy}
                            style={{ minHeight: 44, padding: "0 18px", flexShrink: 0, borderRadius: 12, border: "none", cursor: busy ? "not-allowed" : "pointer", background: GRAD_TEAL, color: "#fff", fontFamily: FONT_D, fontWeight: 700, fontSize: 15, boxShadow: SHADOW_TEAL }}
                          >
                            {t("groupsPageExtra.addBtn")}
                          </button>
                        </div>
                      ))}
                      {available.length === 0 && (
                        <div style={{ fontFamily: FONT_B, fontSize: 15, color: T.muted, textAlign: "center", padding: "16px 0" }}>
                          {noStudentsAtAll ? t("groupsPageExtra.noStudentsYet") : t("groupsPageExtra.noStudents")}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* schedule a group lesson */}
                <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 22 }}>
                  <div style={{ fontFamily: FONT_D, fontWeight: 800, fontSize: 17, color: T.txt, marginBottom: 12 }}>{t("groupsPageExtra.scheduleTitle")}</div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                    <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", gap: 9, minHeight: 58, borderRadius: 15, padding: "0 16px", background: "#fbfbfc", border: `1.5px solid ${T.border}` }}>
                      <CalendarClock size={20} style={{ color: T.muted, flexShrink: 0 }} />
                      <span style={{ fontFamily: FONT_D, fontWeight: 700, fontSize: 16, color: T.txt }}>{schedLabel}</span>
                      <input
                        type="datetime-local"
                        value={schedStart}
                        onChange={(ev) => setSchedStart(ev.target.value)}
                        aria-label={t("groupsPageExtra.scheduleTitle")}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none" }}
                      />
                    </div>
                    <div style={{ width: 96, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 58, borderRadius: 15, background: "#fbfbfc", border: `1.5px solid ${T.border}` }}>
                      <input
                        inputMode="numeric"
                        value={schedDuration}
                        onChange={(ev) => setSchedDuration(ev.target.value.replace(/[^\d]/g, ""))}
                        aria-label={t("groupsPageExtra.durationLabel")}
                        title={t("groupsPageExtra.durationLabel")}
                        style={{ width: 36, textAlign: "right", border: "none", outline: "none", background: "transparent", fontFamily: FONT_D, fontWeight: 700, fontSize: 16, color: T.txt }}
                      />
                      <span style={{ fontFamily: FONT_D, fontWeight: 700, fontSize: 15, color: T.sub }}>{t("groupsPageExtra.durationLabel")}</span>
                    </div>
                  </div>
                  <button
                    onClick={scheduleGroupLesson}
                    disabled={scheduling || active.length === 0}
                    style={{
                      width: "100%", minHeight: 58, borderRadius: 16, border: "none",
                      cursor: scheduling || active.length === 0 ? "not-allowed" : "pointer",
                      background: active.length === 0 ? "#e7e9ef" : GRAD_TEAL,
                      color: active.length === 0 ? T.muted : "#fff",
                      fontFamily: FONT_D, fontWeight: 800, fontSize: 18,
                      boxShadow: active.length === 0 ? "none" : SHADOW_TEAL,
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
                    }}
                  >
                    {scheduling ? <Loader2 className="h-5 w-5 animate-spin" /> : <CalendarClock size={22} strokeWidth={2} />}
                    {t("groupsPageExtra.scheduleForCount", { count: active.length })}
                  </button>
                </div>
              </div>
            )}

            {/* footer */}
            <div style={{ flexShrink: 0, padding: "14px 20px 22px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 12 }}>
              <button
                onClick={archiveGroup}
                style={{ minHeight: 58, padding: "0 20px", borderRadius: 16, border: `2px solid ${T.border}`, background: "#fff", color: T.coral, fontFamily: FONT_D, fontWeight: 700, fontSize: 16, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
              >
                <Trash2 size={19} strokeWidth={2} />
                {t("common.delete")}
              </button>
              <button
                onClick={() => onOpenChange(false)}
                style={{ flex: 1, minHeight: 58, borderRadius: 16, border: "none", cursor: "pointer", background: GRAD_TEAL, color: "#fff", fontFamily: FONT_D, fontWeight: 800, fontSize: 18, boxShadow: SHADOW_TEAL }}
              >
                {t("groupsPageExtra.doneBtn")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {invite && (
        <InviteLinkDialog
          open={invite.open}
          onOpenChange={(o) => setInvite((s) => (s ? { ...s, open: o } : s))}
          personName={invite.name}
          email={invite.email}
          phone={invite.phone}
          role="student"
          studentId={invite.studentId}
        />
      )}
    </>
  );
}
