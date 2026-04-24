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

type Category = "bug" | "idea" | "question" | "other";

const categories: { value: Category; label: string; icon: typeof Bug; description: string }[] = [
  { value: "idea", label: "Ідея", icon: Lightbulb, description: "Що покращити" },
  { value: "bug", label: "Баг", icon: Bug, description: "Щось не працює" },
  { value: "question", label: "Питання", icon: HelpCircle, description: "Потрібна допомога" },
  { value: "other", label: "Інше", icon: MoreHorizontal, description: "Будь-який відгук" },
];

export default function FeedbackPreviewPage() {
  const [open, setOpen] = useState(true);
  const [category, setCategory] = useState<Category>("idea");
  const [rating, setRating] = useState<number>(4);
  const [message, setMessage] = useState("Було б класно мати темну тему в чатах та сповіщення в Telegram про нові уроки.");

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Превʼю CTA «Залишити фідбек»</h1>
          <p className="text-sm text-muted-foreground">
            Демо-сторінка для перегляду UI без авторизації. Плаваюча кнопка справа знизу + діалог.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          ↓ Уявна сторінка застосунку — фідбек-кнопка завжди в куті ↓
        </div>

        {/* Floating button */}
        <Button
          size="lg"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 h-12 gap-2 rounded-full shadow-lg"
        >
          <MessageCircleHeart className="h-5 w-5" />
          Фідбек
        </Button>

        <Dialog open={open} onOpenChange={setOpen}>
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
                        "h-9 w-9 rounded-md border text-base font-medium transition-colors",
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
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Скасувати
                </Button>
                <Button>Надіслати</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
