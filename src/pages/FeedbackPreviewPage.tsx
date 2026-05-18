import { useState } from "react";
import { MessageCircleHeart, Bug, Lightbulb, HelpCircle, MoreHorizontal } from "lucide-react";
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
import { useTranslation } from "react-i18next";

type Category = "bug" | "idea" | "question" | "other";

export default function FeedbackPreviewPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [category, setCategory] = useState<Category>("idea");
  const [rating, setRating] = useState<number>(4);
  const [message, setMessage] = useState("");

  const categories: { value: Category; label: string; icon: typeof Bug; description: string }[] = [
    { value: "idea", label: t("feedback.ideaLabel"), icon: Lightbulb, description: t("feedback.ideaDesc") },
    { value: "bug", label: t("feedback.bugLabel"), icon: Bug, description: t("feedback.bugDesc") },
    { value: "question", label: t("feedback.questionLabel"), icon: HelpCircle, description: t("feedback.questionDesc") },
    { value: "other", label: t("feedback.otherLabel"), icon: MoreHorizontal, description: t("feedback.otherDesc") },
  ];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("feedback.btn")} — Preview</h1>
          <p className="text-sm text-muted-foreground">
            Demo page for UI preview without authorization.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          ↓ Feedback button always in the corner ↓
        </div>

        {/* Floating button */}
        <Button
          size="lg"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 h-12 gap-2 rounded-full shadow-lg"
        >
          <MessageCircleHeart className="h-5 w-5" />
          {t("feedback.title")}
        </Button>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("feedback.subtitle")}</DialogTitle>
              <DialogDescription>
                {t("feedback.description")}
              </DialogDescription>
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
                        "h-9 w-9 rounded-md border text-base font-medium transition-colors",
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
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("feedback.cancel")}
                </Button>
                <Button>{t("feedback.send")}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
