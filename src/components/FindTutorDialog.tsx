import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HandHeart, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  trigger?: React.ReactNode;
  onCreated?: () => void;
}

export function FindTutorDialog({ trigger, onCreated }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    subject: "",
    preferred_level: "",
    budget_note: "",
    message: "",
  });

  const submit = async () => {
    if (!user) return;
    if (!form.subject.trim() && !form.message.trim()) {
      toast.error("Вкажіть предмет або опишіть, що шукаєте");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("tutor_referral_requests").insert({
      student_id: user.id,
      subject: form.subject.trim() || null,
      preferred_level: form.preferred_level.trim() || null,
      budget_note: form.budget_note.trim() || null,
      message: form.message.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      console.error(error);
      toast.error("Не вдалося надіслати запит");
      return;
    }
    toast.success("Запит надіслано! Менеджер скоро з вами зв'яжеться.");
    setOpen(false);
    setForm({ subject: "", preferred_level: "", budget_note: "", message: "" });
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <HandHeart className="mr-2 h-4 w-4" />
            Знайти репетитора через oTutorHub
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Знайти нового репетитора</DialogTitle>
          <DialogDescription>
            Опишіть, кого шукаєте — менеджер oTutorHub підбере вам репетитора з нашого пулу.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Предмет</Label>
            <Input
              placeholder="Наприклад: англійська мова"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Рівень / клас</Label>
            <Input
              placeholder="Початковий, B2, 8 клас…"
              value={form.preferred_level}
              onChange={(e) => setForm({ ...form, preferred_level: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Бюджет (необов'язково)</Label>
            <Input
              placeholder="Наприклад: до 400 ₴/урок"
              value={form.budget_note}
              onChange={(e) => setForm({ ...form, budget_note: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Деталі</Label>
            <Textarea
              rows={3}
              placeholder="Час занять, цілі, особливі побажання…"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Надіслати запит
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
