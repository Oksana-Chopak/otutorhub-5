import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
    let q = supabase
      .from("lessons")
      .update({ student_price: newPrice })
      .eq("tutor_id", tutorId)
      .eq("student_id", studentId)
      .eq("subject", subject);

    if (scope === "future_unpaid") {
      q = q.eq("student_payment_status", "unpaid").gte("starts_at", new Date().toISOString());
    } else if (scope === "all_unpaid") {
      q = q.eq("student_payment_status", "unpaid");
    }
    // "all" — no extra filter

    const { error, count } = await q.select("id", { count: "exact", head: true });
    setBusy(false);
    if (error) {
      toast.error("Не вдалося оновити уроки");
      return;
    }
    toast.success(`Оновлено уроків: ${count ?? 0}`);
    onOpenChange(false);
    onDone?.();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Застосувати нову ціну?</AlertDialogTitle>
          <AlertDialogDescription>
            Ставку «{subject}» змінено з <b>{oldPrice} ₴</b> на <b>{newPrice} ₴</b>.
            Оберіть, до яких уроків застосувати нове значення.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="space-y-2 py-2">
          <div className="flex items-start gap-2">
            <RadioGroupItem value="future_unpaid" id="s-fu" className="mt-1" />
            <Label htmlFor="s-fu" className="font-normal cursor-pointer">
              <div className="font-medium">Майбутні неоплачені (рекомендовано)</div>
              <div className="text-xs text-muted-foreground">Безпечно: оплачені та минулі не змінюються.</div>
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="all_unpaid" id="s-au" className="mt-1" />
            <Label htmlFor="s-au" className="font-normal cursor-pointer">
              <div className="font-medium">Усі неоплачені (минулі + майбутні)</div>
              <div className="text-xs text-muted-foreground">Оплачені залишаються зі старою ціною.</div>
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="all" id="s-all" className="mt-1" />
            <Label htmlFor="s-all" className="font-normal cursor-pointer">
              <div className="font-medium">Усі уроки без винятку</div>
              <div className="text-xs text-muted-foreground text-warning">Перепише і оплачені — попередні фінзвіти зміняться.</div>
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="none" id="s-none" className="mt-1" />
            <Label htmlFor="s-none" className="font-normal cursor-pointer">
              <div className="font-medium">Не чіпати існуючі</div>
              <div className="text-xs text-muted-foreground">Нова ставка діятиме лише для нових уроків.</div>
            </Label>
          </div>
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Скасувати</AlertDialogCancel>
          <AlertDialogAction onClick={apply} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Застосувати
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
