import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Video, BookOpen, FileText, NotebookPen, Save, ExternalLink, Loader2 } from "lucide-react";

interface LessonWorkspaceProps {
  lessonId: string;
  tutorId: string;
  studentId: string;
  meetingUrl: string | null;
  homework: string | null;
  summary: string | null;
  studentNotes: string | null;
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
  onUpdated,
}: LessonWorkspaceProps) {
  const { user, roles } = useAuth();
  const isTutor = user?.id === tutorId;
  const isStudent = user?.id === studentId;
  const isManager = roles.includes("manager");

  const [meetingDraft, setMeetingDraft] = useState(meetingUrl ?? "");
  const [homeworkDraft, setHomeworkDraft] = useState(homework ?? "");
  const [summaryDraft, setSummaryDraft] = useState(summary ?? "");
  const [notesDraft, setNotesDraft] = useState(studentNotes ?? "");
  const [defaultUrl, setDefaultUrl] = useState<string>("");
  const [saving, setSaving] = useState<string | null>(null);

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
    const payload: Record<string, string | null> = { [field]: cleaned || null };
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
      {/* Meeting link */}
      <section className="rounded-lg border border-border bg-background/50 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <Video className="h-4 w-4 text-primary" />
          Онлайн-зустріч
        </div>

        {effectiveMeetingUrl ? (
          <Button asChild size="sm" className="mb-3 w-full">
            <a href={effectiveMeetingUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Приєднатися
            </a>
          </Button>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">Посилання ще не додано.</p>
        )}

        {canEditTutorFields && (
          <div className="space-y-3">
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
          </div>
        )}
      </section>

      {/* Homework */}
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

      {/* Summary / lesson notes */}
      <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="h-4 w-4 text-primary" />
          Конспект уроку
        </div>
        {canEditTutorFields ? (
          <>
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

      {/* Student personal notes */}
      {(canEditStudentNotes || (isManager && studentNotes)) && (
        <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
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
      )}
    </div>
  );
}
