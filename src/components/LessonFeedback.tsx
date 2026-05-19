import { useEffect, useState } from "react";
import { Star, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

interface LessonFeedbackProps {
  lessonId: string;
  tutorId: string;
  studentId: string;
  lessonStatus: string;
}

interface FeedbackRow {
  rating: number;
  comment: string | null;
}

export function LessonFeedback({ lessonId, tutorId, studentId, lessonStatus }: LessonFeedbackProps) {
  const { user, roles } = useAuth();
  const isStudent = user?.id === studentId;
  const isTutor = user?.id === tutorId;
  const isManager = roles.includes("manager");

  const [existing, setExisting] = useState<FeedbackRow | null>(null);
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("lesson_feedback")
        .select("rating, comment")
        .eq("lesson_id", lessonId)
        .eq("student_id", studentId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setExisting(data as FeedbackRow);
        setRating(data.rating);
        setComment(data.comment ?? "");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId, studentId]);

  if (loading) return null;
  if (lessonStatus !== "completed") return null;

  // Tutor/manager view: show feedback if exists, otherwise nothing
  if (!isStudent) {
    if (!existing) {
      if (isTutor || isManager) {
        return (
          <section className="rounded-lg border border-dashed border-border bg-background/30 p-4 md:col-span-2">
            <div className="text-sm text-muted-foreground">
              ⭐ Учень ще не залишив відгук про цей урок.
            </div>
          </section>
        );
      }
      return null;
    }
    return (
      <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
          Відгук учня
        </div>
        <div className="flex items-center gap-1 mb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={`h-5 w-5 ${
                n <= existing.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"
              }`}
            />
          ))}
        </div>
        {existing.comment && (
          <p className="whitespace-pre-wrap text-sm text-foreground">{existing.comment}</p>
        )}
      </section>
    );
  }

  // Student view: rate the lesson
  const save = async () => {
    if (rating < 1) {
      toast({ title: t("lessonFeedback.ratingRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      lesson_id: lessonId,
      tutor_id: tutorId,
      student_id: studentId,
      rating,
      comment: comment.trim() || null,
    };
    const { error } = existing
      ? await supabase
          .from("lesson_feedback")
          .update({ rating, comment: comment.trim() || null })
          .eq("lesson_id", lessonId)
          .eq("student_id", studentId)
      : await supabase.from("lesson_feedback").insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: t("lessonFeedback.saveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setExisting({ rating, comment: comment.trim() || null });
    toast({ title: existing ? t("lessonFeedback.updated") : t("lessonFeedback.submitted") });
  };

  return (
    <section className="rounded-lg border border-border bg-background/50 p-4 md:col-span-2">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        Як пройшов урок?
      </div>
      <div className="mb-3 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="p-1 transition-transform hover:scale-110"
            aria-label={t("lessonFeedback.rateAria", { n })}
          >
            <Star
              className={`h-7 w-7 ${
                n <= (hover || rating)
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground/40"
              }`}
            />
          </button>
        ))}
      </div>
      <Textarea
        rows={3}
        placeholder={t("lessonFeedback.placeholder")}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button size="sm" variant="outline" className="mt-2" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        {existing ? t("lessonFeedback.updateBtn") : t("lessonFeedback.submitBtn")}
      </Button>
    </section>
  );
}
