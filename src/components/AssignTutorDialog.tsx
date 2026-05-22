import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubjectSelect } from "@/components/SubjectSelect";
import { Loader2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: {
    id: string;
    student_id: string;
    studentName?: string;
    subject: string | null;
  } | null;
  onAssigned: () => void;
}

interface TutorOption {
  id: string;
  name: string;
  defaultRate: number | null;
}

export function AssignTutorDialog({ open, onOpenChange, request, onAssigned }: Props) {
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [loadingTutors, setLoadingTutors] = useState(false);
  const [tutorId, setTutorId] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [studentPrice, setStudentPrice] = useState<string>("");
  const [tutorPayout, setTutorPayout] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !request) return;
    setSubject(request.subject ?? "");
    setStudentPrice("");
    setTutorPayout("");
    setTutorId("");
    (async () => {
      setLoadingTutors(true);
      // Load all tutors
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "tutor");
      const tutorIds = (roles ?? []).map((r: any) => r.user_id);
      if (tutorIds.length === 0) {
        setTutors([]);
        setLoadingTutors(false);
        return;
      }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, archived_at, is_pending")
        .in("id", tutorIds);
      const activeTutors = (profs ?? []).filter(
        (p: any) => !p.archived_at && !p.is_pending,
      );
      const { data: tdetails } = await supabase
        .from("tutor_details")
        .select("user_id, rate_per_lesson")
        .in("user_id", activeTutors.map((p: any) => p.id));
      const rateMap = new Map<string, number>();
      for (const t of tdetails ?? []) {
        if (t.rate_per_lesson != null) rateMap.set(t.user_id, Number(t.rate_per_lesson));
      }
      setTutors(
        activeTutors
          .map((p: any) => ({
            id: p.id,
            name:
              `${(p.first_name ?? "").trim()} ${(p.last_name ?? "").trim()}`.trim() ||
              t("assignTutor.noName"),
            defaultRate: rateMap.get(p.id) ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "uk")),
      );
      setLoadingTutors(false);
    })();
  }, [open, request]);

  // When tutor changes — try to prefill payout from their subject rate or default
  useEffect(() => {
    if (!tutorId) return;
    (async () => {
      let payout: number | null = null;
      if (subject.trim()) {
        const { data } = await supabase
          .from("tutor_subject_rates")
          .select("rate_per_lesson")
          .eq("tutor_id", tutorId)
          .eq("subject", subject.trim())
          .maybeSingle();
        if (data?.rate_per_lesson != null) payout = Number(data.rate_per_lesson);
      }
      if (payout == null) {
        const t = tutors.find((x) => x.id === tutorId);
        if (t?.defaultRate != null) payout = t.defaultRate;
      }
      if (payout != null && !tutorPayout) setTutorPayout(String(payout));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorId, subject]);

  const handleAssign = async () => {
    if (!request) return;
    if (!tutorId) {
      toast.error(t("assignTutor.tutorRequired"));
      return;
    }
    if (!subject.trim()) {
      toast.error(t("assignTutor.subjectRequired"));
      return;
    }
    const sp = Number(studentPrice);
    const tp = Number(tutorPayout);
    if (!Number.isFinite(sp) || sp < 0) {
      toast.error(t("assignTutor.invalidStudentRate"));
      return;
    }
    if (!Number.isFinite(tp) || tp < 0) {
      toast.error(t("assignTutor.invalidTutorRate"));
      return;
    }

    setSubmitting(true);

    // 1. Upsert student_rate (manager hub source)
    const { error: rateErr } = await supabase
      .from("student_rates")
      .upsert(
        {
          tutor_id: tutorId,
          student_id: request.student_id,
          subject: subject.trim(),
          price_per_lesson: sp,
          source: "hub",
        },
        { onConflict: "tutor_id,student_id,subject" },
      );
    if (rateErr) {
      setSubmitting(false);
      toast.error(t("assignTutor.rateFailed") + ": " + rateErr.message);
      return;
    }

    // 2. Upsert tutor_subject_rate (so future autofill works)
    const { error: tsrErr } = await supabase
      .from("tutor_subject_rates")
      .upsert(
        {
          tutor_id: tutorId,
          subject: subject.trim(),
          rate_per_lesson: tp,
        },
        { onConflict: "tutor_id,subject" },
      );
    if (tsrErr) {
      // Non-fatal — log and continue
      console.warn("tutor_subject_rates upsert failed:", tsrErr.message);
    }

    // 3. Mark referral request as fulfilled
    const tutorName = tutors.find((t) => t.id === tutorId)?.name ?? t("assignTutorExtra.tutorFallback");
    const responseNote = `${t("assignTutorExtra.assigned")}: ${tutorName}. ${t("assignTutorExtra.subjectLabel")}: ${subject.trim()}. Ціна для учня: ${sp} ₴, виплата: ${tp} ₴.`;
    const { error: reqErr } = await supabase
      .from("tutor_referral_requests")
      .update({
        status: "fulfilled",
        manager_response: responseNote,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    if (reqErr) {
      setSubmitting(false);
      toast.error(t("assignTutorExtra.rateCreatedReqFailed", { error: reqErr.message }));
      return;
    }

    // 4. Create chat thread between tutor and student so they can talk
    try {
      await supabase.rpc("get_or_create_chat_thread", {
        _tutor_id: tutorId,
        _student_id: request.student_id,
      });
    } catch (e) {
      // Non-fatal
    }

    setSubmitting(false);
    toast.success(t("assignTutorExtra.assigned"));
    onAssigned();
    onOpenChange(false);
  };

  const margin =
    studentPrice && tutorPayout
      ? Number(studentPrice) - Number(tutorPayout)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("assignTutorExtra.title")}</DialogTitle>
          <DialogDescription>
            Учень: <span className="font-medium text-foreground">{request?.studentName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("assignTutorExtra.tutorLabel")}</Label>
            {loadingTutors ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
              </div>
            ) : (
              <Select value={tutorId} onValueChange={setTutorId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("assignTutorExtra.selectFromList")} />
                </SelectTrigger>
                <SelectContent>
                  {tutors.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.defaultRate != null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({t.defaultRate} ₴)
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label className="text-xs">{t("assignTutorExtra.subjectLabel")}</Label>
            <SubjectSelect value={subject} onValueChange={(name) => setSubject(name)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("assignTutorExtra.studentRateLabel")}</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={studentPrice}
                onChange={(e) => setStudentPrice(e.target.value)}
                placeholder="600"
              />
            </div>
            <div>
              <Label className="text-xs">{t("assignTutorExtra.tutorRateLabel")}</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={tutorPayout}
                onChange={(e) => setTutorPayout(e.target.value)}
                placeholder="450"
              />
            </div>
          </div>

          {margin != null && (
            <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
              Маржа школи: <span className="font-medium text-foreground">{margin} ₴</span> за урок
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Скасувати
          </Button>
          <Button onClick={handleAssign} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserCheck className="mr-2 h-4 w-4" />
            )}
            Призначити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
