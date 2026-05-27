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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, CheckCircle2, Crown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { insertNotification } from "@/lib/notifications";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

type Billing = "monthly" | "yearly";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultBilling?: Billing;
}

const PRICE_MONTHLY = 249;
const PRICE_YEARLY_PER_MONTH = 199;
const PRICE_YEARLY_TOTAL = PRICE_YEARLY_PER_MONTH * 12;

export function SubscriptionRequestDialog({
  open,
  onOpenChange,
  defaultBilling = "yearly",
}: Props) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [billing, setBilling] = useState<Billing>(defaultBilling);
  const [submitting, setSubmitting] = useState(false);
  const [existingPending, setExistingPending] = useState<{
    id: string;
    status: string;
    created_at: string;
  } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (open) setBilling(defaultBilling);
  }, [open, defaultBilling]);

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

  const planLabel = billing === "yearly" ? "pro_yearly" : "pro_monthly";
  const price = billing === "yearly" ? PRICE_YEARLY_TOTAL : PRICE_MONTHLY;

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    const billingNote =
      billing === "yearly"
        ? t("subscriptionDialog.yearlyPlan", { perMonth: PRICE_YEARLY_PER_MONTH, total: PRICE_YEARLY_TOTAL })
        : t("subscriptionDialog.monthlyPlan", { price: PRICE_MONTHLY });
    const fullMessage = message.trim()
      ? `${billingNote}\n\n${message.trim()}`
      : billingNote;
    const { error } = await supabase.from("subscription_requests").insert({
      tutor_id: user.id,
      plan: planLabel,
      price,
      message: fullMessage,
    });
    setSubmitting(false);
    if (error) {
      toast.error(t("subscriptionDialog.sendFailed"), { description: error.message });
      return;
    }
    toast.success(t("subscriptionDialog.sent"), {
      description: t("subscriptionDialog.sentDesc"),
    });
    // Notify all managers about the Pro request
    const { data: managerRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");
    const tutorName = user?.email?.split("@")[0] ?? t("shared.tutor");
    (managerRoles ?? []).forEach(({ user_id }) => {
      insertNotification({
        userId: user_id,
        type: "pro_request",
        title: t("notifications.proRequestTitle", { name: tutorName }),
        link: "/subscription-requests",
      });
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
          <DialogTitle>{t("subscriptionDialog.title")}</DialogTitle>
          <DialogDescription>
            Оберіть період оплати — менеджер школи отримає ваш запит і зв'яжеться
            для оплати.
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
              <span className="font-medium">{t("subscriptionDialog.alreadySent")}</span>
            </div>
            <p className="text-muted-foreground">
              Менеджер уже отримав ваш запит і скоро з вами зв'яжеться. Дублювати
              не потрібно.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("subscriptionDialog.periodLabel")}</Label>
              <RadioGroup
                value={billing}
                onValueChange={(v) => setBilling(v as Billing)}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <label
                  htmlFor="bill-yearly"
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition",
                    billing === "yearly"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <RadioGroupItem id="bill-yearly" value="yearly" className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">{t("subscriptionDialog.yearly")}</span>
                      <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                        −20%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {PRICE_YEARLY_PER_MONTH} ₴/міс ·{" "}
                      {PRICE_YEARLY_TOTAL} ₴ на рік
                    </p>
                  </div>
                </label>
                <label
                  htmlFor="bill-monthly"
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition",
                    billing === "monthly"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <RadioGroupItem id="bill-monthly" value="monthly" className="mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{t("subscriptionDialog.monthly")}</span>
                    <p className="text-xs text-muted-foreground">
                      {PRICE_MONTHLY} ₴/міс
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="msg">{t("subscriptionDialog.msgLabel")}</Label>
              <Textarea
                id="msg"
                placeholder={t("subscriptionDialog.msgPlaceholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </div>
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
