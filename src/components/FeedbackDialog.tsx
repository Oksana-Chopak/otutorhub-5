import { useState } from "react";
import { Bug, Lightbulb, HelpCircle, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

type Category = "bug" | "idea" | "question" | "other";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>("idea");
  const [rating, setRating] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const categories: { value: Category; label: string; icon: typeof Bug; description: string }[] = [
    { value: "idea", label: t("feedback.ideaLabel"), icon: Lightbulb, description: t("feedback.ideaDesc") },
    { value: "bug", label: t("feedback.bugLabel"), icon: Bug, description: t("feedback.bugDesc") },
    { value: "question", label: t("feedback.questionLabel"), icon: HelpCircle, description: t("feedback.questionDesc") },
    { value: "other", label: t("feedback.otherLabel"), icon: MoreHorizontal, description: t("feedback.otherDesc") },
  ];

  const handleSubmit = async () => {
    if (message.trim().length < 5) {
      toast({ title: t("feedback.placeholder"), description: t("feedback.minChars"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setTimeout(() => {
      toast({ title: t("feedback.thankYouTitle"), description: t("feedback.thankYouDesc") });
      setMessage("");
      setRating(0);
      setCategory("idea");
      onOpenChange(false);
      setSubmitting(false);
    }, 400);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("feedback.subtitle")}</DialogTitle>
          <DialogDescription>{t("feedback.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("feedback.typeLabel")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {categories.map((c) => {
                const Icon = c.icon;
                const active = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-secondary"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="text-xs text-muted-foreground">{c.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("feedback.ratingLabel")}</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? 0 : n)}
                  className={cn(
                    "h-9 w-9 rounded-md border text-sm font-medium transition-colors",
                    rating >= n
                      ? "border-warning bg-warning/10 text-warning"
                      : "border-border text-muted-foreground hover:border-warning/40"
                  )}
                  aria-label={`${n} ${t("feedback.ofFive")}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-message">{t("feedback.msgLabel")}</Label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("feedback.msgPlaceholder")}
              maxLength={1000}
              rows={5}
            />
            <p className="text-right text-xs text-muted-foreground">{message.length}/1000</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("feedback.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? t("feedback.sending") : t("feedback.send")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
