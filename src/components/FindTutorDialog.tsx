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
import { SubjectSelect } from "@/components/SubjectSelect";

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
    preferred_days: "",
    preferred_times: "",
    message: "",
  });

  const submit = async () => {
    if (!user) return;
    if (!form.subject.trim()) {
      toast.error("Вкажіть бажаний предмет");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("tutor_referral_requests").insert({
      student_id: user.id,
      subject: form.subject.trim(),
      preferred_level: form.preferred_level.trim() || null,
      budget_note: form.budget_note.trim() || null,
      preferred_days: form.preferred_days.trim() || null,
      preferred_times: form.preferred_times.trim() || null,
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
    setForm({ subject: "", preferred_level: "", budget_note: "", preferred_days: "", preferred_times: "", message: "" });
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Запит менеджеру на підбір репетитора</DialogTitle>
          <DialogDescription>
            Опишіть, кого шукаєте — менеджер oTutorHub підбере вам репетитора з нашого пулу.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Бажаний предмет *</Label>
            <SubjectSelect
              value={form.subject}
              onValueChange={(name) => setForm({ ...form, subject: name })}
              placeholder="Оберіть предмет"
            />
          </div>
          <div className="space-y-1">
            <Label>Рівень / клас</Label>
            <Input
              placeholder="Початковий, B2, 8 клас…"
              value={form.preferred_level}
              onChange={(e) => setForm({ ...form, preferred_level: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>Орієнтовний діапазон ціни за один урок</Label>
            <Input
              placeholder="Наприклад: 600–800 ₴/урок"
              value={form.budget_note}
              onChange={(e) => setForm({ ...form, budget_note: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>Зручні дні занять</Label>
            <Input
              placeholder="Пн, Ср, Пт або будні / вихідні"
              value={form.preferred_days}
              onChange={(e) => setForm({ ...form, preferred_days: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>Зручні години занять</Label>
            <Input
              placeholder="Наприклад: 17:00–20:00"
              value={form.preferred_times}
              onChange={(e) => setForm({ ...form, preferred_times: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>Особливі побажання</Label>
            <Textarea
              rows={4}
              placeholder="Цілі навчання, формат, особливості, побажання щодо репетитора…"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              maxLength={1500}
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
