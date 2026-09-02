import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/currency";
import { NextStepBar } from "@/components/NextStepBar";
import { useLessonStatus } from "@/hooks/useLessonStatus";
import { getLocale } from "@/lib/locale";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafe } from "@/lib/lessonDetailsSafe";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { getRandomEmoji, type RewardTheme } from "@/lib/rewardThemes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { Video, BookOpen, FileText, NotebookPen, Save, ExternalLink, Loader2, Sparkles, Check, Banknote, ChevronDown, Lightbulb, Lock, Wallet, MessageSquare, Share2 } from "lucide-react";
import { LessonAttachments } from "@/components/LessonAttachments";
import { LessonFeedback } from "@/components/LessonFeedback";
import { RequestReviewButton } from "@/components/RequestReviewButton";
import { WalletDialog } from "@/components/WalletDialog";
import { ChatThreadDialog } from "@/components/ChatThreadDialog";
import { FirefliesPanel } from "@/components/FirefliesPanel";
import { maybeAutoStartFireflies } from "@/lib/aiNotes";
import { usePaywallTracking } from "@/hooks/usePaywallTracking";

interface LessonWorkspaceProps {
  lessonId: string;
  tutorId: string;
  studentId: string;
  meetingUrl: string | null;
  homework: string | null;
  summary: string | null;
  studentNotes: string | null;
  source?: "hub" | "independent";
  studentPrice?: number;
  currency?: string | null;
  studentPaymentStatus?: "paid" | "unpaid";
  lessonStatus?: string;
  onUpdated?: () => void;
  /** B-D2: дає ланцюгу закрити діалог перед deep-link-ом */
  onClose?: () => void;
}

import { sanitizeHttpUrl, safeHref } from "@/lib/safeUrl";
import i18nInstance from "@/i18n";
import { insertNotification } from "@/lib/notifications";
const t = i18nInstance.t.bind(i18nInstance);

const PLATFORMS: { k: string; label: string; ph: string }[] = [
  { k: "zoom", label: "Zoom", ph: "https://us02web.zoom.us/j/…" },
  { k: "meet", label: "Google Meet", ph: "https://meet.google.com/…" },
  { k: "telegram", label: "Telegram", ph: "https://t.me/…" },
  { k: "viber", label: "Viber", ph: "viber://chat?number=…" },
  { k: "other", label: t("lessonWorkspaceExtra.platformOther"), ph: "https://…" },
];
function inferPlatform(url: string): string {
  const u = (url || "").toLowerCase();
  if (!u) return "meet";
  if (u.includes("zoom.")) return "zoom";
  if (u.includes("meet.google")) return "meet";
  if (u.includes("t.me") || u.includes("telegram")) return "telegram";
  if (u.includes("viber")) return "viber";
  return "other";
}
// РЕЛІЗ-БЛОКЕР (фокус): Row МУСИТЬ жити на рівні модуля. Оголошений усередині
// компонента — новий тип на кожен рендер → textarea перестворюється і губить
// фокус після ПЕРШОГО символу. Розтяжка №13 стереже. openRow/toggleRow — пропси.
const L = {
  teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9", txt: "var(--ds-txt,#0f0f1a)",
  sub: "var(--sub,#666b82)", muted: "var(--ds-muted,#6f7489)", border: "var(--ds-border,#eceef3)", bg: "var(--ds-surface2,#fbfbfc)",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};
const Row = ({ emoji, tint, title, preview, k, last, children, openRow, toggleRow }: {
emoji: string; tint: string; title: string; preview: string; k: string; last?: boolean; children: React.ReactNode;
openRow: string | null; toggleRow: (k: string) => void;
}) => {
  const open = openRow === k;
  return (
    <div style={{ borderBottom: last ? "none" : `1px solid ${L.border}` }}>
      <button type="button" onClick={() => toggleRow(k)}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "13px 14px", border: "none", background: "transparent", cursor: "pointer" }}>
        <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, background: tint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{emoji}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: L.display, fontWeight: 700, fontSize: 15, color: L.txt }}>{title}</span>
          {!open && preview && <span style={{ display: "block", fontSize: 14, color: L.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{preview}</span>}
        </span>
        <ChevronDown size={16} style={{ color: L.muted, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
};


export function LessonWorkspace({
  lessonId,
  tutorId,
  studentId,
  meetingUrl,
  homework,
  summary,
  studentNotes,
  source,
  onClose,
  studentPrice,
  currency,
  studentPaymentStatus,
  lessonStatus,
  onUpdated,
}: LessonWorkspaceProps) {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const { isPro, isIndependent, settings, loading: wsLoading } = useWorkspaceSettings();
  const { trackPaywallClick } = usePaywallTracking();
  const isTutor = user?.id === tutorId;
  const [lastSaved, setLastSaved] = useState<null | "homework" | "summary">(null); // B-D2
  const isStudent = user?.id === studentId;
  const isManager = roles.includes("manager");
  // AI summary доступний всім тьюторам у hub-режимі (школа платить),
  // а в самостійному режимі — лише Pro/Trial
  // Аудит 01.09: поки налаштування летять, прапор самостійності = false, тож
  // вираз давав true — безкоштовний самостійний репетитор бачив кнопку AI
  // замість пейволу, а потім вона зникала під рукою. Поки не знаємо — не даємо.
  const aiAllowed = wsLoading ? false : (!isIndependent || isPro);
  const canTogglePayment = (isTutor && source === "independent") || isManager;
  const canMarkCompleted = isTutor || isManager; // P8: свій урок — своя кнопка, конфеті для всіх
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paidLocal, setPaidLocal] = useState<"paid" | "unpaid">(studentPaymentStatus ?? "unpaid");
  const [statusLocal, setStatusLocal] = useState<string>(lessonStatus ?? "scheduled");
  const [completeBusy, setCompleteBusy] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const canOpenWallet = (isTutor && source === "independent") || isManager;

  useEffect(() => {
    setPaidLocal(studentPaymentStatus ?? "unpaid");
    setStatusLocal(lessonStatus ?? "scheduled");
  }, [studentPaymentStatus, lessonStatus, lessonId]);
  // B6: скидання justCompleted тут гасило блок «Учень оплатив?» за мить —
  // onUpdated → перезавантаження пропів → цей ефект. Скидаємо ЛИШЕ при зміні
  // уроку; при позначеній оплаті блок ховає paidLocal-гейт, при закритті — анмаунт.
  useEffect(() => { setJustCompleted(false); }, [lessonId]);

  const togglePayment = async () => {
    setPaymentBusy(true);
    try {
      const next = paidLocal === "paid" ? "unpaid" : "paid";
      const { error } = await updateLessonDetailsSafe(lessonId, { student_payment_status: next });
      setPaymentBusy(false);
      if (error) {
        toast({ title: t("lessonWorkspace.paymentFailed"), description: error.message, variant: "destructive" });
        return;
      }
      setPaidLocal(next);
      toast({ title: next === "paid" ? t("lessonWorkspace.markedPaid") : t("lessonWorkspace.markedUnpaid") });
      onUpdated?.();
    } finally {
      setPaymentBusy(false);
    }
  };

  const { complete: flowComplete } = useLessonStatus();
  const markCompleted = async () => {
    setCompleteBusy(true);
    try {
      const ok = await flowComplete({ id: lessonId, student_id: studentId ?? null, tutor_id: tutorId });
      setCompleteBusy(false);
      if (!ok) return;
      setStatusLocal("completed");
      setJustCompleted(true);
      onUpdated?.();
    } finally {
      setCompleteBusy(false);
    }
  };

  const [meetingDraft, setMeetingDraft] = useState(meetingUrl ?? "");
  const [homeworkDraft, setHomeworkDraft] = useState(homework ?? "");
  const [summaryDraft, setSummaryDraft] = useState(summary ?? "");
  const [notesDraft, setNotesDraft] = useState(studentNotes ?? "");
  const [defaultUrl, setDefaultUrl] = useState<string>("");
  const [saving, setSaving] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [prevLesson, setPrevLesson] = useState<{ starts_at: string; summary: string | null; homework: string | null } | null>(null);
  const [prevOpen, setPrevOpen] = useState(false);
  const [privateNotesDraft, setPrivateNotesDraft] = useState("");
  const [privateNotesSaved, setPrivateNotesSaved] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [platform, setPlatform] = useState("meet");
  const [linkMode, setLinkMode] = useState<"permanent" | "once">("permanent");

  const generateAiSummary = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-lesson-summary", {
        body: { lessonId },
      });
      if (error) throw error;
      const generated = (data as any)?.summary;
      if (!generated) throw new Error(t("lessonWorkspace.aiEmpty"));
      setSummaryDraft(generated);
      // B19: одразу чернетка в БД — закритий діалог не з'їдає згенероване.
      void updateLessonField("summary", generated);
      toast({ title: t("lessonWorkspace.aiReady"), description: t("lessonWorkspaceExtra.aiReadyDesc") });
    } catch (e: any) {
      toast({
        title: t("lessonWorkspaceExtra.aiGenerateFailed"),
        description: e?.message ?? t("lessonWorkspaceExtra.aiGenerateFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    setMeetingDraft(meetingUrl ?? "");
    setHomeworkDraft(homework ?? "");
    setSummaryDraft(summary ?? "");
    setNotesDraft(studentNotes ?? "");
  }, [lessonId, meetingUrl, homework, summary, studentNotes]);

  // D (офлайн): чернетки полів уроку переживають краш/перезавантаження.
  // Оголошені ПІСЛЯ prop-sync ефекту, щоб відновлення не затиралось пропсами.
  const hwLocal = useLocalDraft(lessonId ? `lesson.${lessonId}.homework` : null, homeworkDraft, setHomeworkDraft);
  const sumLocal = useLocalDraft(lessonId ? `lesson.${lessonId}.summary` : null, summaryDraft, setSummaryDraft);
  const noteLocal = useLocalDraft(lessonId ? `lesson.${lessonId}.student_notes` : null, notesDraft, setNotesDraft);
  const meetLocal = useLocalDraft(lessonId ? `lesson.${lessonId}.meeting_url` : null, meetingDraft, setMeetingDraft);
  const privLocal = useLocalDraft(lessonId ? `lesson.${lessonId}.private` : null, privateNotesDraft, setPrivateNotesDraft);
  const draftClears: Record<string, () => void> = {
    homework: hwLocal.clear,
    summary: sumLocal.clear,
    student_notes: noteLocal.clear,
    meeting_url: meetLocal.clear,
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tutor_student_defaults")
        .select("default_meeting_url")
        .eq("tutor_id", tutorId)
        .eq("student_id", studentId)
        .maybeSingle();
      if (!cancelled) setDefaultUrl(data?.default_meeting_url ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [tutorId, studentId]);

  const effectiveMeetingUrl = (meetingUrl && meetingUrl.trim()) || defaultUrl || "";

  // 🧠 «Памʼять учня» lite: останній завершений урок цієї пари перед поточним
  useEffect(() => {
    if (!isTutor) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: prev } = await supabase
          .from("lessons")
          .select("id, starts_at")
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .eq("status", "completed")
          .neq("id", lessonId)
          .order("starts_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!prev || cancelled) { if (!cancelled) setPrevLesson(null); return; }
        const { data: det } = await supabase
          .from("lesson_details")
          .select("summary, homework")
          .eq("lesson_id", prev.id)
          .maybeSingle();
        if (!cancelled) {
          const summary = (det?.summary as string | null) ?? null;
          const homework = (det?.homework as string | null) ?? null;
          setPrevLesson(summary || homework ? { starts_at: prev.starts_at, summary, homework } : null);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [lessonId, tutorId, studentId, isTutor]);

  // №16 (ідеї 01.09): чи позначив учень домашку виконаною (homework_done).
  // Стійко до незастосованої міграції: помилка → просто без чипа.
  const [hwDoneByStudent, setHwDoneByStudent] = useState(false);
  useEffect(() => {
    setHwDoneByStudent(false);
    if (!isTutor || !lessonId || !studentId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("homework_done")
        .select("lesson_id")
        .eq("lesson_id", lessonId)
        .eq("student_id", studentId)
        .limit(1);
      if (!cancelled) setHwDoneByStudent(!error && !!data && data.length > 0);
    })();
    return () => { cancelled = true; };
  }, [lessonId, studentId, isTutor]);

  // Load private per-lesson tutor notes (tutor-only table); resilient if not migrated yet.
  useEffect(() => {
    if (!isTutor) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("lesson_tutor_notes")
          .select("notes")
          .eq("lesson_id", lessonId)
          .maybeSingle();
        if (!cancelled) {
          const v = (data?.notes as string | null) ?? "";
          setPrivateNotesDraft(v);
          setPrivateNotesSaved(v);
        }
      } catch {
        /* table may not exist yet */
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId, isTutor]);

  // Initialise the meeting platform + permanent/once mode from current data.
  useEffect(() => {
    const perLesson = (meetingUrl && meetingUrl.trim()) || "";
    setLinkMode(perLesson ? "once" : "permanent");
    setPlatform(inferPlatform(perLesson || defaultUrl || ""));
  }, [lessonId, meetingUrl, defaultUrl]);

  const savePrivateNotes = async () => {
    setSaving("private_notes");
    const { error } = await (supabase as any)
      .from("lesson_tutor_notes")
      .upsert(
        { lesson_id: lessonId, tutor_id: tutorId, notes: privateNotesDraft.trim() || null },
        { onConflict: "lesson_id" }
      );
    setSaving(null);
    if (error) {
      toast({ title: t("lessonWorkspaceExtra.saveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setPrivateNotesSaved(privateNotesDraft);
    privLocal.clear(); // D: чернетка приватних нотаток очищується після збереження
    toast({ title: t("lessonWorkspaceExtra.saved") });
  };

  const handleJoinClick = () => {
    if (!isTutor || !aiAllowed) return;
    maybeAutoStartFireflies(lessonId, effectiveMeetingUrl).then((started) => {
      if (started) {
        toast({
          title: t("lessonWorkspaceExtra.aiAutoStarted", "✨ AI-конспект"),
          description: t("lessonWorkspaceExtra.aiAutoStartedDesc", "Запис цього уроку розпочато автоматично."),
        });
      }
    });
  };

  const updateLessonField = async (field: "meeting_url" | "homework" | "summary" | "student_notes", value: string) => {
    setSaving(field);
    let cleaned = value;
    if (field === "meeting_url") {
      const trimmed = value.trim();
      if (trimmed) {
        const safe = sanitizeHttpUrl(trimmed);
        if (!safe) {
          setSaving(null);
          toast({
            title: t("lessonWorkspaceExtra.invalidUrl"),
            description: t("lessonWorkspaceExtra.invalidUrlDesc"),
            variant: "destructive",
          });
          return;
        }
        cleaned = safe;
      } else {
        cleaned = "";
      }
    }
    let error: { message: string } | null = null;
    if (field === "meeting_url") {
      const res = await supabase.from("lessons").update({ meeting_url: cleaned || null }).eq("id", lessonId);
      error = res.error;
    } else {
      const res = await updateLessonDetailsSafe(lessonId, { [field]: cleaned || null } as any);
      error = res.error;
    }
    if (!error && (field === "homework" || field === "summary")) setLastSaved(field);
    setSaving(null);
    if (error) {
      toast({ title: t("lessonWorkspaceExtra.saveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    draftClears[field]?.(); // D: збережено в БД — локальна чернетка більше не потрібна
    toast({ title: t("lessonWorkspaceExtra.saved") });
    onUpdated?.();

    // Notify student when tutor adds homework or summary
    if (field === "homework" || field === "summary") {
      const isHomework = field === "homework";
      /* Аудит 02.09: умова була `if (studentId && …)`. У ГРУПОВОГО уроку
         батьківський рядок має student_id = NULL — тобто репетитор писав
         домашку всій групі, а сповіщення не отримував НІХТО. Домашка тихо
         лежала на сторінці, куди ніхто не мав приводу зайти. Тепер: індивід —
         одному учневі, група — усім активним учасникам. */
      let recipients: string[] = studentId ? [studentId] : [];
      if (!studentId) {
        const { data: parts } = await (supabase.from("lesson_participants") as any)
          .select("student_id, status")
          .eq("lesson_id", lessonId);
        recipients = ((parts ?? []) as any[])
          .filter((p) => p.student_id && p.status !== "cancelled")
          .map((p) => p.student_id as string);
      }
      recipients.forEach((uid) => {
        insertNotification({
          userId: uid,
          type: `${field}_added_${lessonId}`,
          title: isHomework ? t("lessonWorkspaceExtra.notifHomeworkTitle") : t("lessonWorkspaceExtra.notifSummaryTitle"),
          body: isHomework
            ? t("lessonWorkspaceExtra.notifHomeworkBody")
            : t("lessonWorkspaceExtra.notifSummaryBody"),
          // B17: учень живе у своїх маршрутах — домашка в /student/homework.
          // 43: конспект теж живе на сторінці домашки (там і рендериться) —
          // /student/schedule не показує конспект узагалі, лінк вів у порожнечу.
          link: "/student/homework",
        });
      });
    }
  };

  const saveDefaultMeetingUrl = async () => {
    if (!isTutor) return;
    setSaving("default");
    const trimmed = defaultUrl.trim();
    let cleaned = "";
    if (trimmed) {
      const safe = sanitizeHttpUrl(trimmed);
      if (!safe) {
        setSaving(null);
        toast({
          title: t("lessonWorkspaceExtra.invalidUrl"),
          description: t("lessonWorkspaceExtra.invalidUrlDesc"),
          variant: "destructive",
        });
        return;
      }
      cleaned = safe;
    }
    const { error } = await supabase
      .from("tutor_student_defaults")
      .upsert(
        { tutor_id: tutorId, student_id: studentId, default_meeting_url: cleaned || null },
        { onConflict: "tutor_id,student_id" }
      );
    setSaving(null);
    if (error) {
      toast({ title: t("lessonWorkspaceExtra.saveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("lessonWorkspaceExtra.linkSaved") });
  };

  const canEditTutorFields = isTutor;
  const canEditStudentNotes = isStudent;

  const fieldCss: React.CSSProperties = {
    width: "100%", borderRadius: 13, padding: "12px 14px", fontSize: 15.5,
    fontFamily: L.body, color: L.txt, background: L.bg, outline: "none",
    border: `1.5px solid ${L.border}`, boxSizing: "border-box", resize: "none", lineHeight: 1.5,
  };
  const toggleRow = (k: string) => setOpenRow((v) => (v === k ? null : k));

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
      {/* 0. Primary CTA — mark lesson as completed */}
      {(lastSaved || (statusLocal === "completed" && (!summary || paidLocal === "unpaid"))) && (
        <div className="mb-3">
          <NextStepBar
            icon={lastSaved === "homework" ? "✍️" : lastSaved === "summary" ? "📅" : paidLocal === "unpaid" ? "💳" : "📝"}
            text={
              lastSaved === "homework" ? t("nextStep.afterHomework")
              : lastSaved === "summary" ? t("nextStep.afterSummary")
              : paidLocal === "unpaid" ? t("nextStep.lessonUnpaid")
              : t("nextStep.addSummary")
            }
            actionLabel={
              lastSaved === "homework" ? t("nextStep.openSummary")
              : lastSaved === "summary" ? t("nextStep.createNext")
              : paidLocal === "unpaid" ? t("nextStep.markPaid")
              : t("nextStep.openSummary")
            }
            onAction={() => {
              if (lastSaved === "homework") { toggleRow("summary"); setLastSaved(null); }
              else if (lastSaved === "summary") { onClose?.(); navigate(`/schedule?create=1${studentId ? `&student=${studentId}` : ""}`); }
              else if (paidLocal === "unpaid") { void togglePayment(); }
              else { toggleRow("summary"); }
            }}
            onDismiss={() => { setLastSaved(null); /* bar може повернутися зі стану, якщо урок досі unpaid */ }}
          />
        </div>
      )}
      {canMarkCompleted && statusLocal === "scheduled" && (
        <section className="rounded-[16px] border border-primary/30 bg-primary/5 p-4 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-foreground">
              <div className="font-medium">{t("lessonWorkspaceExtra.notCompleted")}</div>
              <div className="text-[14px] text-muted-foreground mt-0.5">
                {t("lessonWorkspaceExtra.notCompletedHint")}
              </div>
            </div>
            <Button size="lg" onClick={markCompleted} disabled={completeBusy}>
              {completeBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {t("lessonWorkspaceExtra.lessonHappened")}
            </Button>
          </div>
        </section>
      )}

      {/* 0b. Post-completion nudge to record payment */}
      {canTogglePayment && statusLocal === "completed" && paidLocal === "unpaid" && !lastSaved && ( /* Р5+41: стан, не подія */
        <section className="rounded-[16px] border border-warning/30 bg-warning/5 p-4 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-foreground">
              <div className="font-medium">{t("lessonWorkspaceExtra.studentPaidQuestion")}</div>
              <div className="text-[14px] text-muted-foreground mt-0.5">
                {studentPrice ? t("lessonWorkspaceExtra.pricePrefix", { price: studentPrice }) : ""}{t("lessonWorkspaceExtra.recordPaymentHint")}
              </div>
            </div>
            <Button size="lg" variant="default" onClick={togglePayment} disabled={paymentBusy}>
              {paymentBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
              {t("lessonWorkspaceExtra.markPayment")}
            </Button>
          </div>
        </section>
      )}

      {/* 0c. Hub tutor info — payment is handled by manager */}
      {isTutor && source === "hub" && statusLocal === "completed" && (
        <section className="rounded-[16px] border border-border bg-muted/30 p-3 md:col-span-2 text-[14px] text-muted-foreground">
          {t("lessonWorkspaceExtra.hubPaymentInfo")}
        </section>
      )}


      {canTogglePayment && (
        <section className="rounded-[16px] border border-border bg-background/50 p-4 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Banknote className="h-4 w-4 text-primary" />
              {t("lessonWorkspaceExtra.lessonPayment")}
              {studentPrice !== undefined && studentPrice !== null && (
                <span className="ml-1 text-muted-foreground">— {formatPrice(Number(studentPrice) || 0, currency ?? "UAH")}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={
                  paidLocal === "paid"
                    ? "rounded-full bg-success/10 px-2 py-0.5 text-[14px] font-medium text-success"
                    : "rounded-full bg-warning/10 px-2 py-0.5 text-[14px] font-medium text-warning"
                }
              >
                {paidLocal === "paid" ? t("lessonWorkspaceExtra.paid") : t("lessonWorkspaceExtra.unpaid")}
              </span>
              <Button
                size="sm"
                variant={paidLocal === "paid" ? "outline" : "default"}
                disabled={paymentBusy}
                onClick={togglePayment}
              >
                {paymentBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                {paidLocal === "paid" ? t("lessonWorkspaceExtra.unmarkPaid") : t("lessonWorkspaceExtra.markPaid")}
              </Button>
              {canOpenWallet && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWalletOpen(true)}
                  title={t("lessonWorkspaceExtra.walletTooltip")}
                >
                  <Wallet className="h-4 w-4 text-primary" />
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TUTOR EDIT — private notes + accordion (homework / summary / meeting) */}
      {canEditTutorFields && (
        <section className="md:col-span-2" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 🧠 Минулий урок — контекст перед заняттям */}
          {prevLesson && (
            <div style={{ borderRadius: 14, border: "1px solid rgba(99,102,241,.25)", background: "rgba(99,102,241,.06)", overflow: "hidden" }}>
              <button type="button" onClick={() => setPrevOpen((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "11px 13px", border: "none", background: "transparent", cursor: "pointer" }}>
                <span style={{ fontSize: 16 }}>🧠</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: L.display, fontWeight: 700, fontSize: 15, color: L.txt }}>
                    {t("lessonWorkspaceExtra.prevLessonHeader", { date: new Date(prevLesson.starts_at).toLocaleDateString(getLocale(), { day: "numeric", month: "short" }) })}
                  </span>
                  {!prevOpen && (
                    <span style={{ display: "block", fontSize: 14, color: L.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>
                      {(prevLesson.summary || prevLesson.homework || "").split("\n")[0]}
                    </span>
                  )}
                </span>
                <ChevronDown size={15} style={{ color: L.muted, flexShrink: 0, transform: prevOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
              </button>
              {prevOpen && (
                <div style={{ padding: "0 13px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {prevLesson.summary && (
                    <div>
                      <div style={{ fontFamily: L.display, fontWeight: 700, fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase", color: L.sub, marginBottom: 3 }}>{t("lessonWorkspaceExtra.prevCovered")}</div>
                      <p style={{ fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap", color: L.txt }}>{prevLesson.summary}</p>
                    </div>
                  )}
                  {prevLesson.homework && (
                    <div>
                      <div style={{ fontFamily: L.display, fontWeight: 700, fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase", color: L.sub, marginBottom: 3 }}>{t("lessonWorkspaceExtra.prevHomework")}</div>
                      <p style={{ fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap", color: L.txt }}>{prevLesson.homework}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 🔒 Private per-lesson notes */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
              <span style={{ width: 22, height: 22, borderRadius: 7, background: "rgba(245,181,68,.2)", color: "#9a6a12", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🔒</span>
              <span style={{ fontFamily: L.display, fontWeight: 700, fontSize: 14, color: L.sub }}>{t("lessonWorkspaceExtra.privateNotesLabel")}</span>
            </div>
            <textarea aria-label={t("lessonWorkspaceExtra.privateNotesPlaceholder")} rows={3} value={privateNotesDraft} onChange={(e) => setPrivateNotesDraft(e.target.value)}
              placeholder={t("lessonWorkspaceExtra.privateNotesPlaceholder")}
              style={{ ...fieldCss, background: "#FFFCF4", border: "1.5px solid rgba(245,181,68,.35)" }} />
            {privateNotesDraft !== privateNotesSaved && (
              <button className="tap-44" type="button" onClick={savePrivateNotes} disabled={saving === "private_notes"}
                style={{ marginTop: 9, display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", border: `1.5px solid ${L.teal}`, background: L.tealL, color: L.tealD, fontFamily: L.display, fontWeight: 700, fontSize: 15 }}>
                {saving === "private_notes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("lessonWorkspaceExtra.saveBtn")}
              </button>
            )}
          </div>

          {/* Accordion */}
          <div style={{ borderRadius: 16, border: `1.5px solid ${L.border}`, background: "var(--ds-surface,#fff)" }}>
            {/* 📚 Homework */}
            <Row openRow={openRow} toggleRow={toggleRow} emoji="📚" tint="rgba(43,191,170,.1)" title={t("lessonWorkspaceExtra.homeworkTitle")}
              preview={hwDoneByStudent ? `✅ ${t("lessonWorkspaceExtra.homeworkDoneByStudent")}` : homeworkDraft ? homeworkDraft.split("\n")[0] : t("lessonWorkspaceExtra.addPreview")} k="hw">
              {/* №16: петля замкнулась — учень позначив, репетитор бачить */}
              {isTutor && hwDoneByStudent && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, borderRadius: 11, padding: "8px 12px", marginBottom: 9, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", fontFamily: L.body, fontSize: 14, fontWeight: 600, color: "#16a34a" }}>
                  ✅ {t("lessonWorkspaceExtra.homeworkDoneByStudent")}
                </div>
              )}
              <textarea aria-label={t("lessonWorkspaceExtra.homeworkPlaceholder")} rows={3} value={homeworkDraft} onChange={(e) => setHomeworkDraft(e.target.value)}
                placeholder={t("lessonWorkspaceExtra.homeworkPlaceholder")} style={fieldCss} />
              {homeworkDraft !== (homework ?? "") && (
                <button type="button" disabled={saving === "homework"} onClick={() => updateLessonField("homework", homeworkDraft)}
                  style={{ marginTop: 9, display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", border: `1.5px solid ${L.teal}`, background: L.tealL, color: L.tealD, fontFamily: L.display, fontWeight: 700, fontSize: 15 }}>
                  {saving === "homework" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t("lessonWorkspaceExtra.saveBtn")}
                </button>
              )}
            </Row>

            {/* ✨ Summary + AI */}
            <Row openRow={openRow} toggleRow={toggleRow} emoji="✨" tint="rgba(245,181,68,.14)" title={t("lessonWorkspaceExtra.summaryTitle")}
              preview={summaryDraft ? summaryDraft.split("\n")[0] : t("lessonWorkspaceExtra.summaryEmptyPreview")} k="ai">
              {aiAllowed && settings?.ai_notes_auto && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", borderRadius: 12, border: "1px solid rgba(43,191,170,.3)", background: "rgba(43,191,170,.08)", padding: "10px 12px", marginBottom: 10, fontSize: 14, color: L.txt, lineHeight: 1.45 }}>
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: L.teal }} />
                  <span><b>{t("lessonWorkspaceExtra.autoOnTitle")}</b> {t("lessonWorkspaceExtra.autoOnBody")}{settings?.ai_notes_auto_send ? t("lessonWorkspaceExtra.autoOnSend") : ""}.</span>
                </div>
              )}
              <textarea aria-label={t("lessonWorkspaceExtra.summaryPlaceholder")} rows={4} value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)}
                placeholder={t("lessonWorkspaceExtra.summaryPlaceholder")} style={fieldCss} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 9, alignItems: "center" }}>
                {aiAllowed ? (
                  <button className="tap-44" type="button" onClick={generateAiSummary} disabled={aiLoading}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", border: "none", background: "linear-gradient(135deg,#FBE08A,#F5B544)", color: "#7a5a14", fontFamily: L.display, fontWeight: 700, fontSize: 15, boxShadow: "0 4px 14px -4px rgba(245,181,68,.7)" }}>
                    {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {aiLoading ? t("lessonWorkspaceExtra.aiGenerating") : t("lessonWorkspaceExtra.aiBtn")}
                  </button>
                ) : (
                  <button type="button" onClick={() => { trackPaywallClick("ai_summary", "lesson_workspace", { lessonId }); navigate("/subscription?from=ai_summary"); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", border: `1.5px solid ${L.teal}`, background: "var(--ds-surface,#fff)", color: L.tealD, fontFamily: L.display, fontWeight: 700, fontSize: 15 }}>
                    <Lock className="h-4 w-4" /> {t("lessonWorkspaceExtra.aiBtnPro")}
                  </button>
                )}
                {summaryDraft !== (summary ?? "") && (
                  <button type="button" disabled={saving === "summary"} onClick={() => updateLessonField("summary", summaryDraft)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", border: "none", background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", fontFamily: L.display, fontWeight: 700, fontSize: 15, boxShadow: "0 6px 16px -6px rgba(43,191,170,.6)" }}>
                    {saving === "summary" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("lessonWorkspaceExtra.saveAndSend")}
                  </button>
                )}
                {!!summaryDraft.trim() && (
                  <button type="button"
                    onClick={async () => {
                      const text = summaryDraft.trim();
                      try {
                        if (navigator.share) await navigator.share({ title: t("lessonWorkspaceExtra.shareTitle"), text });
                        else { await navigator.clipboard.writeText(text); toast({ title: t("lessonWorkspaceExtra.copied"), description: t("lessonWorkspaceExtra.copiedDesc") }); }
                      } catch { /* user cancelled */ }
                    }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 13px", borderRadius: 11, cursor: "pointer", border: `1px solid ${L.border}`, background: "var(--ds-surface,#fff)", color: L.sub, fontFamily: L.display, fontWeight: 700, fontSize: 15 }}>
                    <Share2 className="h-4 w-4" /> {t("lessonWorkspaceExtra.shareBtn")}
                  </button>
                )}
              </div>
            </Row>

            {/* 🎥 Meeting link */}
            <Row openRow={openRow} toggleRow={toggleRow} emoji="🎥" tint="rgba(59,130,246,.1)" title={t("lessonWorkspaceExtra.meetingTitle")}
              preview={`${(PLATFORMS.find((p) => p.k === platform) || PLATFORMS[0]).label} · ${linkMode === "permanent" ? t("lessonWorkspaceExtra.permanentShort") : t("lessonWorkspaceExtra.onceShort")}`}
              k="link" last>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
                {PLATFORMS.map((p) => {
                  const on = p.k === platform;
                  return (
                    <button key={p.k} type="button" onClick={() => setPlatform(p.k)}
                      style={{ height: 34, padding: "0 12px", borderRadius: 999, cursor: "pointer", border: `1.5px solid ${on ? L.teal : L.border}`, background: on ? L.tealL : "#fff", color: on ? L.tealD : L.txt, fontFamily: L.display, fontWeight: 700, fontSize: 14 }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input aria-label={(PLATFORMS.find((p) => p.k === platform) || PLATFORMS[0]).ph}
                  value={linkMode === "once" ? meetingDraft : defaultUrl}
                  onChange={(e) => (linkMode === "once" ? setMeetingDraft(e.target.value) : setDefaultUrl(e.target.value))}
                  placeholder={(PLATFORMS.find((p) => p.k === platform) || PLATFORMS[0]).ph}
                  style={{ ...fieldCss, height: 48, padding: "0 14px", flex: 1 }} />
                <button type="button"
                  disabled={saving === "meeting_url" || saving === "default"}
                  onClick={() => (linkMode === "once" ? updateLessonField("meeting_url", meetingDraft) : saveDefaultMeetingUrl())}
                  style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 13, border: `1.5px solid ${L.teal}`, background: L.tealL, color: L.tealD, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {saving === "meeting_url" || saving === "default" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </button>
              </div>
              <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "rgba(15,15,26,.06)", marginTop: 10 }}>
                {([["permanent", t("lessonWorkspaceExtra.permanent")], ["once", t("lessonWorkspaceExtra.once")]] as const).map(([k, l]) => {
                  const on = k === linkMode;
                  return (
                    <button key={k} type="button" onClick={() => setLinkMode(k as "permanent" | "once")}
                      style={{ flex: 1, border: "none", cursor: "pointer", padding: "9px 0", borderRadius: 9, fontFamily: L.display, fontWeight: 700, fontSize: 14, background: on ? "#fff" : "transparent", color: on ? L.txt : L.sub, boxShadow: on ? "0 1px 4px rgba(15,15,26,.06)" : "none" }}>
                      {l}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 14, color: L.muted, marginTop: 7, lineHeight: 1.4 }}>
                {linkMode === "permanent" ? t("lessonWorkspaceExtra.permanentHint") : t("lessonWorkspaceExtra.onceHint")}
              </div>
              {effectiveMeetingUrl && (
                <a className="tap-44" href={safeHref(effectiveMeetingUrl)} target="_blank" rel="noopener noreferrer" onClick={handleJoinClick}
                  style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 7, height: 42, padding: "0 16px", borderRadius: 12, background: L.teal, color: "var(--ds-txt,#0f0f1a)", fontFamily: L.display, fontWeight: 700, fontSize: 14, textDecoration: "none", boxShadow: "0 6px 16px -6px rgba(43,191,170,.6)" }}>
                  <ExternalLink className="h-4 w-4" /> {t("lessonWorkspaceExtra.joinBtn")}
                </a>
              )}
            </Row>
          </div>
        </section>
      )}

      {/* 2. Homework — read-only for non-tutors (tutors edit in the accordion above) */}
      {!canEditTutorFields && (
      <section className="rounded-[16px] border border-border bg-background/50 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <BookOpen className="h-4 w-4 text-primary" />
          {t("lessonWorkspaceExtra.homeworkHeading")}
        </div>
        {canEditTutorFields ? (
          <>
            <Textarea aria-label={t("lessonWorkspaceExtra.homeworkPlaceholder")}
              rows={4}
              placeholder={t("lessonWorkspaceExtra.homeworkPlaceholder")}
              value={homeworkDraft}
              onChange={(e) => setHomeworkDraft(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={saving === "homework" || homeworkDraft === (homework ?? "")}
              onClick={() => updateLessonField("homework", homeworkDraft)}
            >
              {saving === "homework" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t("lessonWorkspaceExtra.saveBtn")}
            </Button>
          </>
        ) : homework ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">{homework}</p>
        ) : (
          <p className="text-[14px] text-muted-foreground">{t("lessonWorkspaceExtra.noHomework")}</p>
        )}
      </section>
      )}

      {/* 3. Student personal notes (compact slot — second column on top row) */}
      {(canEditStudentNotes || (isManager && studentNotes)) ? (
        <section className="rounded-[16px] border border-border bg-background/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <NotebookPen className="h-4 w-4 text-primary" />
            {t("lessonWorkspaceExtra.myNotes")} {isManager && !canEditStudentNotes && <span className="text-[14px] text-muted-foreground">{t("lessonWorkspaceExtra.studentNotesTag")}</span>}
          </div>
          {canEditStudentNotes ? (
            <>
              <Textarea aria-label={t("lessonWorkspaceExtra.notesPlaceholder")}
                rows={4}
                className="italic"
                placeholder={t("lessonWorkspaceExtra.notesPlaceholder")}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={saving === "student_notes" || notesDraft === (studentNotes ?? "")}
                onClick={() => updateLessonField("student_notes", notesDraft)}
              >
                {saving === "student_notes" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {t("lessonWorkspaceExtra.saveBtn")}
              </Button>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-foreground">{studentNotes}</p>
          )}
        </section>
      ) : (
        // Empty placeholder so the homework block doesn't span both columns awkwardly
        <div className="hidden md:block" />
      )}

      {/* 4. Lesson summary — read-only for non-tutors */}
      {!canEditTutorFields && (
      <section className="rounded-[16px] border border-border bg-background/50 p-4 md:col-span-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="h-4 w-4 text-primary" />
            {t("lessonWorkspaceExtra.summaryHeading")}
          </div>
          {canEditTutorFields && (
            aiAllowed ? (
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={aiLoading}
                onClick={generateAiSummary}
                title={t("lessonWorkspaceExtra.aiTooltip")}
              >
                {aiLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t("lessonWorkspaceExtra.aiSummaryBtn")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => {
                  trackPaywallClick("ai_summary", "lesson_workspace", { lessonId });
                  navigate("/subscription?from=ai_summary");
                }}
                title={t("lessonWorkspaceExtra.aiProTooltip")}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                {t("lessonWorkspaceExtra.aiSummaryBtnPro")}
              </Button>
            )
          )}
        </div>
        {aiAllowed && settings?.ai_notes_auto && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-2.5 text-[14px] text-foreground/80">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>
              <span className="font-medium text-foreground">{t("lessonWorkspaceExtra.autoSummaryOnTitle")}</span> {t("lessonWorkspaceExtra.autoSummaryOnBody")}{settings?.ai_notes_auto_send ? t("lessonWorkspaceExtra.autoSummaryOnSend") : ""}.
            </p>
          </div>
        )}
        {canEditTutorFields ? (
          <>
            {aiAllowed && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[14px] text-foreground/80">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p>
                  <span className="font-medium text-foreground">{t("lessonWorkspaceExtra.tipLabel")}</span> {t("lessonWorkspaceExtra.tipBody")}
                </p>
              </div>
            )}
            <Textarea aria-label={t("lessonWorkspaceExtra.summaryPlaceholder")}
              rows={5}
              placeholder={t("lessonWorkspaceExtra.summaryPlaceholder")}
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={saving === "summary" || summaryDraft === (summary ?? "")}
              onClick={() => updateLessonField("summary", summaryDraft)}
            >
              {saving === "summary" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t("lessonWorkspaceExtra.saveBtn")}
            </Button>
          </>
        ) : summary ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">{summary}</p>
        ) : (
          <p className="text-[14px] text-muted-foreground">{t("lessonWorkspaceExtra.noSummary")}</p>
        )}
      </section>
      )}

      {/* 5. Attachments */}
      <section className="rounded-[16px] border border-border bg-background/50 p-4 md:col-span-2">
        <LessonAttachments lessonId={lessonId} tutorId={tutorId} studentId={studentId} />
      </section>

      {/* 5a. Fireflies AI recording */}
      <FirefliesPanel
        lessonId={lessonId}
        tutorId={tutorId}
        meetingUrl={(meetingUrl && meetingUrl.trim()) || defaultUrl || null}
        canRecord={isTutor && aiAllowed}
        canView={isTutor || isStudent || isManager}
      />

      {/* 5b. Lesson feedback (student rating) — only for completed lessons */}
      {isTutor && statusLocal === "completed" && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-background/50 p-4 md:col-span-2">
          <p className="text-sm text-muted-foreground">
            {t("requestReview.tutorHint") || "Попросіть учня залишити відгук про цей урок 🌟"}
          </p>
          <RequestReviewButton tutorId={tutorId} studentId={studentId} />
        </section>
      )}
      <LessonFeedback
        lessonId={lessonId}
        tutorId={tutorId}
        studentId={studentId}
        lessonStatus={lessonStatus ?? ""}
      />

      {/* 6. Meeting link — read-only compact row for non-tutors (tutors edit in the accordion) */}
      {!canEditTutorFields && (
      <section className="rounded-[16px] border border-border bg-background/50 p-4 md:col-span-2">
        {canEditTutorFields ? (
          <Collapsible>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Video className="h-4 w-4 text-primary" />
                {t("lessonWorkspaceExtra.onlineMeeting")}
                {effectiveMeetingUrl ? (
                  <span className="text-[14px] font-normal text-success">{t("lessonWorkspaceExtra.linkExists")}</span>
                ) : (
                  <span className="text-[14px] font-normal text-warning">{t("lessonWorkspaceExtra.linkMissing")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {effectiveMeetingUrl && (
                  <Button asChild size="sm" variant="outline">
                    <a href={safeHref(effectiveMeetingUrl)} target="_blank" rel="noopener noreferrer" onClick={handleJoinClick}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t("lessonWorkspaceExtra.openBtn")}
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setChatOpen(true)}
                  title={t("lessonWorkspaceExtra.chatTooltip")}
                >
                  <MessageSquare className="mr-1 h-4 w-4" />
                  {t("lessonWorkspaceExtra.writeBtn")}
                </Button>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="group">
                    {t("lessonWorkspaceExtra.editBtn")}
                    <ChevronDown className="ml-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent className="mt-3 space-y-3">
              <div>
                <Label className="text-[14px] text-muted-foreground">{t("lessonWorkspaceExtra.lessonLinkLabel")}</Label>
                <div className="mt-1 flex gap-2">
                  <Input aria-label={t("lessonWorkspace.meetingLink")}
                    placeholder="https://meet.google.com/…"
                    value={meetingDraft}
                    onChange={(e) => setMeetingDraft(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving === "meeting_url" || meetingDraft === (meetingUrl ?? "")}
                    onClick={() => updateLessonField("meeting_url", meetingDraft)}
                  >
                    {saving === "meeting_url" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-[14px] text-muted-foreground">{t("lessonWorkspaceExtra.permanentLinkLabel")}</Label>
                <div className="mt-1 flex gap-2">
                  <Input aria-label={t("lessonWorkspace.meetingLink")}
                    placeholder="https://us02web.zoom.us/j/…"
                    value={defaultUrl}
                    onChange={(e) => setDefaultUrl(e.target.value)}
                  />
                  <Button size="sm" variant="outline" disabled={saving === "default"} onClick={saveDefaultMeetingUrl}>
                    {saving === "default" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-1 text-[14px] text-muted-foreground">
                  {t("lessonWorkspaceExtra.permanentLinkHint")}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Video className="h-4 w-4 text-primary" />
              {t("lessonWorkspaceExtra.onlineMeeting")}
            </div>
            <div className="flex items-center gap-2">
              {effectiveMeetingUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={safeHref(effectiveMeetingUrl)} target="_blank" rel="noopener noreferrer" onClick={handleJoinClick}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t("lessonWorkspaceExtra.joinMeetingBtn")}
                  </a>
                </Button>
              ) : (
                <span className="text-[14px] text-muted-foreground">{t("lessonWorkspaceExtra.noLink")}</span>
              )}
              {(isStudent || isTutor) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setChatOpen(true)}
                  title={t("lessonWorkspaceExtra.chatBtn")}
                >
                  <MessageSquare className="mr-1 h-4 w-4" />
                  {t("lessonWorkspaceExtra.chatLabel")}
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
      )}

      {canOpenWallet && (
        <WalletDialog
          open={walletOpen}
          onOpenChange={setWalletOpen}
          tutorId={tutorId}
          studentId={studentId}
          ratePerLesson={studentPrice}
        />
      )}

      <ChatThreadDialog
        open={chatOpen}
        onOpenChange={setChatOpen}
        tutorId={tutorId}
        studentId={studentId}
      />
    </div>
  );
}
