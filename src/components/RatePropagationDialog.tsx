import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateLessonDetailsSafeBulk } from "@/lib/lessonDetailsSafe";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

type Scope = "none" | "future_unpaid" | "all_unpaid" | "all";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tutorId: string;
  studentId: string;
  subject: string;
  newPrice: number;
  oldPrice: number;
  onDone?: () => void;
}

export function RatePropagationDialog({
  open,
  onOpenChange,
  tutorId,
  studentId,
  subject,
  newPrice,
  oldPrice,
  onDone,
}: Props) {
  const [scope, setScope] = useState<Scope>("future_unpaid");
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (scope === "none") {
      onOpenChange(false);
      onDone?.();
      return;
    }
    setBusy(true);
    // student_payment_status read through the masked lessons_visible view
    // (GRANT-locked on lesson_details); a manager sees the real status here.
    try {
      let q = supabase
        .from("lessons_visible")
        .select("id, student_payment_status")
        .eq("tutor_id", tutorId)
        .eq("student_id", studentId)
        .eq("subject", subject);

      if (scope === "future_unpaid") {
        q = q.eq("student_payment_status", "unpaid").gte("starts_at", new Date().toISOString());
      } else if (scope === "all_unpaid") {
        q = q.eq("student_payment_status", "unpaid");
      }

      const { data: rows, error: selErr } = await q;
      if (selErr) {
        setBusy(false);
        toast.error(t("ratePropagation.updateFailed"));
        return;
      }
      const ids = (rows ?? []).map((r: any) => r.id);
      if (ids.length === 0) {
        setBusy(false);
        toast.success(t("ratePropagation.updatedZero"));
        onOpenChange(false);
        onDone?.();
        return;
      }
      const { error } = await updateLessonDetailsSafeBulk(ids, { student_price: newPrice });
      setBusy(false);
      if (error) {
        toast.error(t("ratePropagation.updateFailed"));
        return;
      }
      toast.success(t("ratePropagation.updated", { count: ids.length }));
      onOpenChange(false);
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("ratePropagation.dialogTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("ratePropagation.applyDescription", { subject, oldPrice, newPrice })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* 14.11, хвиля форм: кожен варіант — картка на всю ширину (дотик будь-де, не в кружечок
            16px), обраний — бірюзова рамка. Логіка вибору та запис — без змін. */}
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="space-y-2 py-2">
          {([
            { v: "future_unpaid", id: "s-fu", title: t("ratePropagationExtra.futureUnpaidOption"), desc: t("ratePropagationExtra.futureUnpaidDesc"), warn: false },
            { v: "all_unpaid", id: "s-au", title: t("ratePropagationExtra.allUnpaidOption"), desc: t("ratePropagationExtra.allUnpaidDesc"), warn: false },
            { v: "all", id: "s-all", title: t("ratePropagationExtra.allOption"), desc: t("ratePropagationExtra.allDesc"), warn: true },
            { v: "none", id: "s-none", title: t("ratePropagationExtra.skipOption"), desc: t("ratePropagationExtra.skipDesc"), warn: false },
          ] as const).map((o) => {
            const on = scope === o.v;
            return (
              <label
                key={o.v}
                htmlFor={o.id}
                data-scope-option={o.v}
                className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-[13px] border-[1.5px] px-3.5 py-3"
                style={on
                  ? { background: "var(--teal-l)", borderColor: "var(--teal)" }
                  : { background: "var(--ds-surface2)", borderColor: "var(--ds-border)" }}
              >
                <RadioGroupItem value={o.v} id={o.id} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold text-foreground" style={{ lineHeight: 1.3 }}>{o.title}</span>
                  <span className={`mt-0.5 block text-[14px] ${o.warn ? "text-warning" : "text-muted-foreground"}`} style={{ lineHeight: 1.4 }}>{o.desc}</span>
                </span>
              </label>
            );
          })}
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); apply(); }}
            className="h-[50px] rounded-[14px] text-[16px] font-semibold"
            style={{background:"var(--teal,#2BBFAA)",color:"#0f0f1a"}}
          >
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {t("ratePropagation.applyBtn")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
