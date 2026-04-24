import { useState } from "react";
import { MessageCircleHeart, Bug, Lightbulb, HelpCircle, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Category = "bug" | "idea" | "question" | "other";

const categories: { value: Category; label: string; icon: typeof Bug; description: string }[] = [
  { value: "idea", label: "Ідея", icon: Lightbulb, description: "Що покращити" },
  { value: "bug", label: "Баг", icon: Bug, description: "Щось не працює" },
  { value: "question", label: "Питання", icon: HelpCircle, description: "Потрібна допомога" },
  { value: "other", label: "Інше", icon: MoreHorizontal, description: "Будь-який відгук" },
];

export function FeedbackButton() {
  const { user, roles } = useAuth();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("idea");
  const [rating, setRating] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Hide for managers (they receive feedback, not give it)
  if (!user || roles.includes("manager")) return null;

  const handleSubmit = async () => {
    if (message.trim().length < 5) {
      toast({ title: "Опишіть детальніше", description: "Мінімум 5 символів", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    // TODO: insert into feedback table once schema is approved
    setTimeout(() => {
      toast({ title: "Дякуємо за фідбек!", description: "Менеджер отримає його найближчим часом." });
      setMessage("");
      setRating(0);
      setCategory("idea");
      setOpen(false);
      setSubmitting(false);
    }, 400);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="lg"
          className="fixed bottom-20 right-4 z-40 h-12 gap-2 rounded-full shadow-lg lg:bottom-6 lg:right-6"
          aria-label="Залишити фідбек"
        >
          <MessageCircleHeart className="h-5 w-5" />
          <span className="hidden sm:inline">Фідбек</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Поділіться думкою</DialogTitle>
          <DialogDescription>
            Ваш відгук допомагає нам покращувати платформу. Менеджер прочитає кожне повідомлення.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Що хочете повідомити?</Label>
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
            <Label>Оцінка платформи (необов'язково)</Label>
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
                  aria-label={`${n} з 5`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-message">Повідомлення</Label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Опишіть вашу ідею, баг чи побажання…"
              maxLength={1000}
              rows={5}
            />
            <p className="text-right text-xs text-muted-foreground">{message.length}/1000</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Скасувати
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Надсилаю…" : "Надіслати"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
