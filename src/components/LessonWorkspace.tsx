import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { Video, BookOpen, FileText, NotebookPen, Save, ExternalLink, Loader2, Sparkles, Check, Banknote, ChevronDown, Lightbulb, Lock, Wallet, MessageSquare } from "lucide-react";
import { LessonAttachments } from "@/components/LessonAttachments";
import { LessonFeedback } from "@/components/LessonFeedback";
import { WalletDialog } from "@/components/WalletDialog";
import { ChatThreadDialog } from "@/components/ChatThreadDialog";
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
  studentPaymentStatus?: "paid" | "unpaid";
  lessonStatus?: string;
  onUpdated?: () => void;
}

function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export function LessonWorkspace({
  lessonId,
  tutorId,
  studentId,
  meetingUrl,
  homework,
  summary,
  studentNotes,
  source,
  studentPrice,
  studentPaymentStatus,
  lessonStatus,
  onUpdated,
}: LessonWorkspaceProps) {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const { isPro, isIndependent } = useWorkspaceSettings();
  const { trackPaywallClick } = usePaywallTracking();
  const isTutor = user?.id === tutorId;
  const isStudent = user?.id === studentId;
  const isManager = roles.includes("manager");
  // AI summary доступний всім тьюторам у hub-режимі (школа платить),
  // а в самостійному режимі — лише Pro/Trial
  const aiAllowed = !isIndependent || isPro;
  const canTogglePayment = (isTutor && source === "independent") || isManager;
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paidLocal, setPaidLocal] = useState<"paid" | "unpaid">(studentPaymentStatus ?? "unpaid");
  const [walletOpen, setWalletOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const canOpenWallet = (isTutor && source === "independent") || isManager;

  useEffect(() => {
    setPaidLocal(studentPaymentStatus ?? "unpaid");
  }, [studentPaymentStatus, lessonId]);

  const togglePayment = async () => {
    setPaymentBusy(true);
    const next = paidLocal === "paid" ? "unpaid" : "paid";
    const { error } = await supabase
      .from("lessons")
      .update({ student_payment_status: next })
      .eq("id", lessonId);
    setPaymentBusy(false);
    if (error) {
      toast({ title: "Не вдалося оновити оплату", description: error.message, variant: "destructive" });
      return;
    }
    setPaidLocal(next);
    toast({ title: next === "paid" ? "Позначено як оплачено" : "Позначено як неоплачено" });
    onUpdated?.();
  };

  const [meetingDraft, setMeetingDraft] = useState(meetingUrl ?? "");
  const [homeworkDraft, setHomeworkDraft] = useState(homework ?? "");
  const [summaryDraft, setSummaryDraft] = useState(summary ?? "");
  const [notesDraft, setNotesDraft] = useState(studentNotes ?? "");
  const [defaultUrl, setDefaultUrl] = useState<string>("");
  const [saving, setSaving] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const generateAiSummary = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-lesson-summary", {
        body: { lessonId },
      });
      if (error) throw error;
      const generated = (data as any)?.summary;
      if (!generated) throw new Error("Порожня відповідь AI");
      setSummaryDraft(generated);
      toast({ title: "AI-конспект готовий", description: "Перевірте і збережіть." });
    } catch (e: any) {
      toast({
        title: "Не вдалося згенерувати конспект",
        description: e?.message ?? "Спробуйте ще раз пізніше",
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

  const updateLessonField = async (field: "meeting_url" | "homework" | "summary" | "student_notes", value: string) => {
    setSaving(field);
    const cleaned = field === "meeting_url" ? normalizeUrl(value) : value;
    const payload = { [field]: cleaned || null } as never;
    const { error } = await supabase.from("lessons").update(payload).eq("id", lessonId);
    setSaving(null);
    if (error) {
      toast({ title: "Не вдалося зберегти", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Збережено" });
    onUpdated?.();
  };

  const saveDefaultMeetingUrl = async () => {
    if (!isTutor) return;
    setSaving("default");
    const cleaned = normalizeUrl(defaultUrl);
    const { error } = await supabase
      .from("tutor_student_defaults")
      .upsert(
        { tutor_id: tutorId, student_id: studentId, default_meeting_url: cleaned || null },
        { onConflict: "tutor_id,student_id" }
      );
    setSaving(null);
    if (error) {
      toast({ title: "Не вдалося зберегти", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Постійне посилання збережено" });
  };

  const canEditTutorFields = isTutor;
  const canEditStudentNotes = isStudent;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* 1. Payment status — top priority */}
      {canTogglePayment && (
        <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Banknote className="h-4 w-4 text-primary" />
              Оплата уроку
              {studentPrice !== undefined && studentPrice !== null && (
                <span className="ml-1 text-muted-foreground">— {studentPrice} ₴</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={
                  paidLocal === "paid"
                    ? "rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
                    : "rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                }
              >
                {paidLocal === "paid" ? "Оплачено" : "Не оплачено"}
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
                {paidLocal === "paid" ? "Скасувати оплату" : "Позначити оплаченим"}
              </Button>
              {canOpenWallet && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWalletOpen(true)}
                  title="Гаманець (передоплата / списання)"
                >
                  <Wallet className="h-4 w-4 text-primary" />
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 2. Homework */}
      <section className="rounded-lg border border-border bg-background/50 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <BookOpen className="h-4 w-4 text-primary" />
          Домашнє завдання
        </div>
        {canEditTutorFields ? (
          <>
            <Textarea
              rows={4}
              placeholder="Що потрібно виконати до наступного уроку…"
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
              Зберегти
            </Button>
          </>
        ) : homework ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">{homework}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Поки що домашки немає.</p>
        )}
      </section>

      {/* 3. Student personal notes (compact slot — second column on top row) */}
      {(canEditStudentNotes || (isManager && studentNotes)) ? (
        <section className="rounded-lg border border-border bg-background/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <NotebookPen className="h-4 w-4 text-primary" />
            Мої нотатки {isManager && !canEditStudentNotes && <span className="text-xs text-muted-foreground">(учня)</span>}
          </div>
          {canEditStudentNotes ? (
            <>
              <Textarea
                rows={4}
                placeholder="Що було незрозуміло, питання до репетитора, власні думки…"
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
                Зберегти
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

      {/* 4. Lesson summary */}
      <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="h-4 w-4 text-primary" />
            Конспект уроку
          </div>
          {canEditTutorFields && (
            aiAllowed ? (
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={aiLoading}
                onClick={generateAiSummary}
                title="AI допише детальний конспект на основі ваших нотаток"
              >
                {aiLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                ✨ AI-конспект
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
                title="AI-конспект доступний на тарифі Pro"
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                ✨ AI-конспект (Pro)
              </Button>
            )
          )}
        </div>
        {canEditTutorFields ? (
          <>
            {aiAllowed && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-xs text-foreground/80">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p>
                  <span className="font-medium text-foreground">Порада:</span> коротко занотуйте тему та головні
                  пункти уроку (наприклад: «Past Simple — твердження, заперечення, неправильні дієслова»),
                  і AI розпише конспект детальніше — структуровано, з прикладами та порадами що повторити. 📝
                </p>
              </div>
            )}
            <Textarea
              rows={5}
              placeholder="Що пройшли на уроці, ключові моменти, посилання на матеріали…"
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
              Зберегти
            </Button>
          </>
        ) : summary ? (
          <p className="whitespace-pre-wrap text-sm text-foreground">{summary}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Конспект ще не додано.</p>
        )}
      </section>

      {/* 5. Attachments */}
      <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
        <LessonAttachments lessonId={lessonId} tutorId={tutorId} studentId={studentId} />
      </section>

      {/* 5b. Lesson feedback (student rating) — only for completed lessons */}
      <LessonFeedback
        lessonId={lessonId}
        tutorId={tutorId}
        studentId={studentId}
        lessonStatus={lessonStatus ?? ""}
      />

      {/* 6. Meeting link — moved to the bottom (low priority, rarely edited).
             Tutors get a collapsible editor; non-editors see only a compact link row. */}
      <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
        {canEditTutorFields ? (
          <Collapsible>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Video className="h-4 w-4 text-primary" />
                Онлайн-зустріч
                {effectiveMeetingUrl ? (
                  <span className="text-xs font-normal text-success">· посилання є</span>
                ) : (
                  <span className="text-xs font-normal text-warning">· посилання немає</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {effectiveMeetingUrl && (
                  <Button asChild size="sm" variant="outline">
                    <a href={effectiveMeetingUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Відкрити
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setChatOpen(true)}
                  title="Написати учню"
                >
                  <MessageSquare className="mr-1 h-4 w-4" />
                  Написати
                </Button>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="group">
                    Редагувати
                    <ChevronDown className="ml-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent className="mt-3 space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Посилання для цього уроку</Label>
                <div className="mt-1 flex gap-2">
                  <Input
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
                <Label className="text-xs text-muted-foreground">Постійне посилання для цієї пари</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    placeholder="https://us02web.zoom.us/j/…"
                    value={defaultUrl}
                    onChange={(e) => setDefaultUrl(e.target.value)}
                  />
                  <Button size="sm" variant="outline" disabled={saving === "default"} onClick={saveDefaultMeetingUrl}>
                    {saving === "default" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Використовується, якщо для уроку не задано окреме посилання.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Video className="h-4 w-4 text-primary" />
              Онлайн-зустріч
            </div>
            {effectiveMeetingUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={effectiveMeetingUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Приєднатися
                </a>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Посилання ще не додано.</span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
