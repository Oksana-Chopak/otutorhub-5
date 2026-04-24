import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, CheckCircle2, Crown } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SubscriptionRequestDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [existingPending, setExistingPending] = useState<{
    id: string;
    status: string;
    created_at: string;
  } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!open || !user) return;
    setChecking(true);
    supabase
      .from("subscription_requests")
      .select("id, status, created_at")
      .eq("tutor_id", user.id)
      .in("status", ["new", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setExistingPending(data ?? null);
        setChecking(false);
      });
  }, [open, user?.id]);

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    const { error } = await supabase.from("subscription_requests").insert({
      tutor_id: user.id,
      plan: "pro",
      price: 145,
      message: message.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Не вдалося надіслати запит", { description: error.message });
      return;
    }
    toast.success("Запит надіслано менеджеру", {
      description: "Ми зв'яжемося з вами найближчим часом.",
    });
    setMessage("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Crown className="h-5 w-5" />
          </div>
          <DialogTitle>Оформити Pro-підписку</DialogTitle>
          <DialogDescription>
            Менеджер школи отримає ваш запит і зв'яжеться з вами для оплати тарифу
            145 ₴/міс.
          </DialogDescription>
        </DialogHeader>

        {checking ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : existingPending ? (
          <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
            <div className="mb-1 inline-flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Запит уже надіслано</span>
            </div>
            <p className="text-muted-foreground">
              Менеджер уже отримав ваш запит і скоро з вами зв'яжеться. Дублювати
              не потрібно.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="msg">Повідомлення менеджеру (опційно)</Label>
            <Textarea
              id="msg"
              placeholder="Зручний спосіб зв'язку, побажання тощо…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={1000}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрити
          </Button>
          {!existingPending && (
            <Button onClick={submit} disabled={submitting || checking}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Надіслати запит
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
