import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Video } from "lucide-react";
import { InviteLinkDialog } from "@/components/InviteLinkDialog";
import { SubjectSelect } from "@/components/SubjectSelect";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}

const empty = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  telegram: "",
  subject: "",
  price: "",
  default_meeting_url: "",
};

/**
 * Lightweight inline dialog to add a student without leaving the page.
 * Mirrors the create flow of MyStudentsPage. Only for independent tutors.
 */
export function QuickAddStudentDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [invite, setInvite] = useState<{
    open: boolean;
    name: string;
    email: string | null;
    phone: string | null;
    studentId: string | null;
    emailSent: boolean;
  } | null>(null);

  const submit = async () => {
    if (!user) return;
    const fn = form.first_name.trim();
    const ln = form.last_name.trim();
    const email = form.email.trim() || null;
    const phone = form.phone.trim() || null;
    const subject = form.subject.trim();
    const price = Number(form.price);

    if (!fn) return toast.error("Вкажіть ім'я учня");
    if (!email && !phone) return toast.error("Потрібен email або телефон");
    if (!subject) return toast.error("Вкажіть предмет");
    if (isNaN(price) || price < 0) return toast.error("Введіть коректну ціну");

    setSubmitting(true);
    const newId = crypto.randomUUID();

    const { error: profErr } = await supabase
      .from("profiles")
      .insert({ id: newId, first_name: fn, last_name: ln, is_pending: true });
    if (profErr) {
      setSubmitting(false);
      return toast.error(profErr.message || "Не вдалося створити профіль");
    }
    const { error: roleErr } = await supabase
      .from("user_roles")
      .insert({ user_id: newId, role: "student" });
    if (roleErr) {
      await supabase.from("profiles").delete().eq("id", newId);
      setSubmitting(false);
      return toast.error("Не вдалося призначити роль");
    }
    const { error: rateErr } = await supabase.from("student_rates").insert({
      tutor_id: user.id,
      student_id: newId,
      subject,
      price_per_lesson: price,
      source: "independent",
    });
    if (rateErr) {
      await supabase.from("user_roles").delete().eq("user_id", newId);
      await supabase.from("profiles").delete().eq("id", newId);
      setSubmitting(false);
      return toast.error("Не вдалося зберегти ціну");
    }
    const { error: contErr } = await supabase.from("profile_contacts").insert({
      user_id: newId,
      email,
      phone,
      telegram: form.telegram.trim() || null,
    });
    if (contErr) {
      await supabase.from("student_rates").delete().eq("tutor_id", user.id).eq("student_id", newId);
      await supabase.from("user_roles").delete().eq("user_id", newId);
      await supabase.from("profiles").delete().eq("id", newId);
      setSubmitting(false);
      return toast.error(
        String(contErr.message || "").includes("email_lower")
          ? "Цей email вже зареєстровано"
          : "Не вдалося зберегти контакти"
      );
    }
    await supabase.from("student_details").upsert({ user_id: newId }, { onConflict: "user_id" });
    const meetingUrl = form.default_meeting_url.trim();
    if (meetingUrl) {
      await supabase.from("tutor_student_defaults").upsert(
        { tutor_id: user.id, student_id: newId, default_meeting_url: meetingUrl },
        { onConflict: "tutor_id,student_id" }
      );
    }

    toast.success("Учня додано 🎉");
    let inviteSent = false;
    if (email) {
      const { data: resp } = await supabase.functions.invoke("send-student-invite", {
        body: { studentId: newId },
      });
      if ((resp as any)?.success) inviteSent = true;
    }

    setSubmitting(false);
    setForm(empty);
    onOpenChange(false);
    setInvite({
      open: true,
      name: `${fn} ${ln}`.trim(),
      email,
      phone,
      studentId: newId,
      emailSent: inviteSent,
    });
    onCreated?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Додати учня</DialogTitle>
            <DialogDescription>
              Заповніть основне — учень отримає запрошення приєднатися.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Ім'я</Label>
                <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Прізвище</Label>
                <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Телефон</Label>
                <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Telegram</Label>
              <Input
                placeholder="@username"
                value={form.telegram}
                onChange={(e) => setForm({ ...form, telegram: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Предмет</Label>
                <SubjectSelect
                  value={form.subject}
                  onValueChange={(name) => setForm({ ...form, subject: name })}
                />
              </div>
              <div className="space-y-1">
                <Label>Ціна за урок (₴)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 text-muted-foreground" />
                Постійне посилання Zoom / Meet (необов'язково)
              </Label>
              <Input
                type="url"
                placeholder="https://zoom.us/j/..."
                value={form.default_meeting_url}
                onChange={(e) => setForm({ ...form, default_meeting_url: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Скасувати
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Додати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {invite && (
        <InviteLinkDialog
          open={invite.open}
          onOpenChange={(v) => setInvite((p) => (p ? { ...p, open: v } : p))}
          personName={invite.name}
          email={invite.email}
          phone={invite.phone}
          studentId={invite.studentId}
          emailSent={invite.emailSent}
          role="student"
        />
      )}
    </>
  );
}
