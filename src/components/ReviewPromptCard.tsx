import { useEffect, useState, useCallback } from "react";
import { getLocale } from "@/lib/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Star, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useHaptic } from "@/hooks/useHaptic";
import { burstConfetti } from "@/lib/confetti";

interface UnratedLesson {
  id: string;
  subject: string;
  starts_at: string;
  tutor_id: string;
  tutor_name: string;
}

/**
 * ReviewPromptCard — the core of the review-collection loop.
 *
 * Shown on the student dashboard. Finds the student's most recent *completed*
 * lessons that don't have feedback yet and invites a quick rating (stars +
 * optional one-line comment) right where attention already is. Writes directly
 * to `lesson_feedback` — the RLS policy "Student inserts own feedback for
 * completed lesson" allows this. After a rating, it advances to the next
 * unrated lesson or hides itself.
 */
export function ReviewPromptCard({ onRated }: { onRated?: () => void }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { success: hapticSuccess } = useHaptic();
  const [queue, setQueue] = useState<UnratedLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // Completed lessons for this student, newest first.
    const { data: lessons } = await supabase
      .from("lessons")
      .select("id, subject, starts_at, tutor_id")
      .eq("student_id", user.id)
      .eq("status", "completed")
      .order("starts_at", { ascending: false })
      .limit(30);

    const lessonRows = (lessons ?? []) as Array<{ id: string; subject: string; starts_at: string; tutor_id: string }>;
    if (lessonRows.length === 0) {
      setQueue([]);
      setLoading(false);
      return;
    }

    // Which of these already have feedback from this student?
    const ids = lessonRows.map((l) => l.id);
    const { data: fb } = await supabase
      .from("lesson_feedback")
      .select("lesson_id")
      .eq("student_id", user.id)
      .in("lesson_id", ids);
    const rated = new Set((fb ?? []).map((f: { lesson_id: string }) => f.lesson_id));

    const unrated = lessonRows.filter((l) => !rated.has(l.id));
    if (unrated.length === 0) {
      setQueue([]);
      setLoading(false);
      return;
    }

    // Resolve tutor names.
    const tutorIds = Array.from(new Set(unrated.map((l) => l.tutor_id)));
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", tutorIds);
    const nameOf = new Map(
      (profs ?? []).map((p: { id: string; first_name: string | null; last_name: string | null }) => [
        p.id,
        `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("studentPages.tutorFallback"),
      ])
    );

    setQueue(
      unrated.map((l) => ({
        ...l,
        tutor_name: nameOf.get(l.tutor_id) ?? t("studentPages.tutorFallback"),
      }))
    );
    setLoading(false);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  const current = queue.find((l) => !dismissed.has(l.id)) ?? null;

  const submit = async () => {
    if (!user || !current || rating === 0) return;
    setSaving(true);
    const { error } = await supabase.from("lesson_feedback").insert({
      lesson_id: current.id,
      student_id: user.id,
      tutor_id: current.tutor_id,
      rating,
      comment: comment.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(t("reviewPrompt.saveFailed") || "Не вдалося надіслати відгук");
      return;
    }
    // Reviewing is a prosocial "win" we actively solicit — celebrate it like
    // homework-done (haptic + confetti), not just a silent toast.
    hapticSuccess();
    burstConfetti({ count: 14 });
    toast.success(t("reviewPrompt.thanks") || "Дякуємо за відгук! 🌟");
    setRating(0);
    setHover(0);
    setComment("");
    setDismissed((prev) => new Set(prev).add(current.id));
    onRated?.();
  };

  const skip = () => {
    if (!current) return;
    setRating(0);
    setHover(0);
    setComment("");
    setDismissed((prev) => new Set(prev).add(current.id));
  };

  if (loading || !current) return null;

  const fmtDate = new Date(current.starts_at).toLocaleDateString(getLocale(), { day: "numeric", month: "long" });

  return (
    <div
      className="ds-pop-in"
      style={{
        borderRadius: 20,
        padding: 18,
        background: "linear-gradient(135deg, #ffffff 0%, #f0fdf9 100%)",
        border: "1px solid rgba(43,191,170,.25)",
        boxShadow: "0 4px 16px -6px rgba(43,191,170,.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: "Inter, system-ui", fontWeight: 800, fontSize: 16, color: "#0f0f1a", lineHeight: 1.25 }}>
            {t("reviewPrompt.title", { tutor: current.tutor_name }) || `Як пройшов урок з ${current.tutor_name}?`}
          </p>
          <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 14, color: "#6b7280", marginTop: 3 }}>
            {current.subject} · {fmtDate}
          </p>
        </div>
        <button
          onClick={skip}
          aria-label={t("reviewPrompt.skip") || "Пропустити"}
          className="hover:bg-black/5"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <X size={16} style={{ color: "var(--sub,#6b7088)" }} />
        </button>
      </div>

      {/* Stars */}
      <div style={{ display: "flex", gap: 6, marginTop: 14, marginBottom: rating > 0 ? 12 : 4 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= (hover || rating);
          return (
            <button
              key={n}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              aria-label={`${n}`}
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, transition: "transform .12s cubic-bezier(.34,1.56,.64,1)", transform: active ? "scale(1.08)" : "scale(1)" }}
            >
              <Star size={32} style={{ color: active ? "#F5B400" : "#e2e5ec", fill: active ? "#F5B400" : "#e2e5ec" }} />
            </button>
          );
        })}
      </div>

      {/* Comment + submit appear after a rating is chosen */}
      {rating > 0 && (
        <div className="ds-pop-in">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("reviewPrompt.commentPlaceholder") || "Додай кілька слів (необов'язково)…"}
            rows={2}
            style={{
              width: "100%", borderRadius: 12, border: "1px solid #eceef3", padding: "10px 12px",
              fontFamily: "'Plus Jakarta Sans', system-ui", fontSize: 14, resize: "none", outline: "none",
              marginBottom: 10,
            }}
          />
          <button
            onClick={submit}
            disabled={saving}
            style={{
              width: "100%", height: 48, borderRadius: 14, border: "none", color: "#0f0f1a",
              background: "linear-gradient(135deg,#2BBFAA,#25a896)",
              fontFamily: "Inter, system-ui", fontWeight: 700, fontSize: 15,
              cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1,
              boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {t("reviewPrompt.submit") || "Надіслати відгук"}
          </button>
        </div>
      )}
    </div>
  );
}

export default ReviewPromptCard;
