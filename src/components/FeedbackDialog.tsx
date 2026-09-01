import { useState } from "react";
import { Star, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useHaptic } from "@/hooks/useHaptic";

type Category = "bug" | "idea" | "question" | "other";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// DS tokens — same palette/typography the newer sheets use
const F = {
  teal: "#2BBFAA",
  border: "var(--ds-border,#eceef3)",
  txt: "var(--ds-txt,#0f0f1a)",
  sub: "var(--sub,#666b82)",
  display: "Inter, system-ui, sans-serif",
  body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const [category, setCategory] = useState<Category>("idea");
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const categories: { value: Category; emoji: string; label: string }[] = [
    { value: "idea", emoji: "💡", label: t("feedback.ideaLabel") },
    { value: "bug", emoji: "🐞", label: t("feedback.bugLabel") },
    { value: "question", emoji: "❓", label: t("feedback.questionLabel") },
    { value: "other", emoji: "💬", label: t("feedback.otherLabel") },
  ];

  const handleSubmit = async () => {
    if (message.trim().length < 5) {
      toast({ title: t("feedback.placeholder"), description: t("feedback.minChars"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("feedback_submissions").insert({
        user_id: user?.id,
        category,
        message: message.trim(),
        rating: rating > 0 ? rating : null,
        page_url: typeof window !== "undefined" ? window.location.pathname : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });
      setSubmitting(false);
      if (error) {
        const friendly = /does not exist|42P01/i.test(error.message)
          ? t("feedback.storageNotReady")
          : error.message;
        toast({ title: t("feedback.errorTitle"), description: friendly, variant: "destructive" });
        return;
      }
      haptic.success();
      toast({ title: t("feedback.thankYouTitle"), description: t("feedback.thankYouDesc") });
      setMessage("");
      setRating(0);
      setCategory("idea");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] overflow-y-auto">
        {/* Drag handle */}
        <div className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full sm:hidden" style={{ background: "rgba(15,15,26,.14)" }} />
        <div style={{ padding: "12px 20px 20px" }}>
          <DialogTitle asChild>
            <p style={{ fontFamily: F.display, fontWeight: 800, fontSize: 19, color: F.txt, letterSpacing: "-0.01em" }}>
              {t("feedback.subtitle")}
            </p>
          </DialogTitle>
          <p style={{ fontFamily: F.body, fontSize: 14.5, color: F.sub, marginTop: 3, lineHeight: 1.45 }}>
            {t("feedback.description")}
          </p>

          {/* Category chips */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
            {categories.map((c) => {
              const active = category === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => { setCategory(c.value); haptic.tap(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "12px 13px",
                    borderRadius: 14, cursor: "pointer", textAlign: "left",
                    border: active ? `1.5px solid ${F.teal}` : `1px solid ${F.border}`,
                    background: active ? "rgba(43,191,170,.08)" : "#fff",
                    boxShadow: active ? "0 4px 14px -6px rgba(43,191,170,.4)" : "none",
                    transition: "all .15s ease",
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{c.emoji}</span>
                  <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14, color: active ? "#0F6E56" : F.txt }}>
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Stars — golden, same feel as the student review prompt */}
          <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, letterSpacing: ".05em", textTransform: "uppercase", color: F.sub, margin: "18px 0 6px" }}>
            {t("feedback.ratingLabel")}
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const activeStar = n <= (hover || rating);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? 0 : n)}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  aria-label={`${n} ${t("feedback.ofFive")}`}
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2,
                    transition: "transform .12s cubic-bezier(.34,1.56,.64,1)", transform: activeStar ? "scale(1.08)" : "scale(1)" }}
                >
                  <Star size={30} style={{ color: activeStar ? "#F5B400" : "#e2e5ec", fill: activeStar ? "#F5B400" : "#e2e5ec" }} />
                </button>
              );
            })}
          </div>

          {/* Message */}
          <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13, letterSpacing: ".05em", textTransform: "uppercase", color: F.sub, margin: "18px 0 6px" }}>
            {t("feedback.msgLabel")}
          </p>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("feedback.msgPlaceholder")}
            maxLength={1000}
            rows={4}
            style={{
              width: "100%", borderRadius: 14, border: `1px solid ${F.border}`, padding: "12px 14px",
              fontFamily: F.body, fontSize: 15, resize: "none", outline: "none", background: "var(--ds-surface,#fff)",
            }}
            onFocus={(e) => { e.currentTarget.style.border = `1.5px solid ${F.teal}`; }}
            onBlur={(e) => { e.currentTarget.style.border = `1px solid ${F.border}`; }}
          />
          <p style={{ textAlign: "right", fontFamily: F.body, fontSize: 13, color: F.sub, marginTop: 4 }}>
            {message.length}/1000
          </p>

          {/* Submit — full-width teal per DS (dark text on teal is intentional) */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              marginTop: 12, width: "100%", height: 50, borderRadius: 14, border: "none",
              background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a",
              fontFamily: F.display, fontWeight: 700, fontSize: 16,
              cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1,
              boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {submitting && <Loader2 size={17} className="animate-spin" />}
            {submitting ? t("feedback.sending") : t("feedback.send")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
