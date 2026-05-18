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
import { useTranslation } from "react-i18next";

interface Props {
  trigger?: React.ReactNode;
  onCreated?: () => void;
}

export function FindTutorDialog({ trigger, onCreated }: Props) {
  const { t } = useTranslation();
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
      toast.error(t("findTutor.subjectRequired"));
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
      toast.error(t("findTutor.requestFailed"));
      return;
    }
    toast.success(t("findTutor.requestSent"));
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
            {t("findTutor.dialogTitle")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("findTutor.requestTitle")}</DialogTitle>
          <DialogDescription>
            {t("findTutor.requestDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("findTutor.subjectLabel")}</Label>
            <SubjectSelect
              value={form.subject}
              onValueChange={(name) => setForm({ ...form, subject: name })}
              placeholder={t("findTutor.subjectPlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("findTutor.levelLabel")}</Label>
            <Input
              placeholder={t("findTutor.levelPlaceholder")}
              value={form.preferred_level}
              onChange={(e) => setForm({ ...form, preferred_level: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("findTutor.priceLabel")}</Label>
            <Input
              placeholder={t("findTutor.pricePlaceholder")}
              value={form.budget_note}
              onChange={(e) => setForm({ ...form, budget_note: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("findTutor.daysLabel")}</Label>
            <Input
              placeholder={t("findTutor.daysPlaceholder")}
              value={form.preferred_days}
              onChange={(e) => setForm({ ...form, preferred_days: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("findTutor.hoursLabel")}</Label>
            <Input
              placeholder={t("findTutor.hoursPlaceholder")}
              value={form.preferred_times}
              onChange={(e) => setForm({ ...form, preferred_times: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("findTutor.wishesLabel")}</Label>
            <Textarea
              rows={4}
              placeholder={t("findTutor.wishesPlaceholder")}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              maxLength={1500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("findTutor.cancelBtn")}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("findTutor.submitBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
