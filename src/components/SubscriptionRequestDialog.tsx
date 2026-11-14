import { useEffect, useState } from "react";
import { priceLabel, totalLabel, PRICE_TOTAL, PLAN_DISCOUNT } from "@/lib/pricing";
import { Textarea } from "@/components/ui/textarea";
import { AREA_CLASS, FieldLabel } from "@/components/form/canon";
import { FormSheet, SheetButton } from "@/components/form/FormSheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, CheckCircle2, Crown } from "lucide-react";
import { toast } from "sonner";
import { notifyManagers, newRequestId, requestNotificationType } from "@/lib/notifications";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

type Billing = "monthly" | "halfyear" | "yearly";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultBilling?: Billing;
}

// 02.09: єдине джерело цін — src/lib/pricing.ts, гривня.

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

  const planLabel = billing === "yearly" ? "pro_yearly" : billing === "halfyear" ? "pro_halfyear" : "pro_monthly";
  const price = PRICE_TOTAL[billing];

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      const billingNote =
        billing === "yearly"
          ? t("subscriptionDialog.yearlyPlan", { perMonth: priceLabel("yearly"), total: totalLabel("yearly") })
          : billing === "halfyear"
          ? t("subscriptionDialog.halfyearPlan", { perMonth: priceLabel("halfyear"), total: totalLabel("halfyear") })
          : t("subscriptionDialog.monthlyPlan", { price: priceLabel("monthly") });
      const fullMessage = message.trim()
        ? `${billingNote}\n\n${message.trim()}`
        : billingNote;
      const requestId = newRequestId();
      const { error } = await supabase.from("subscription_requests").insert({
        id: requestId,
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
      // Сповістити платформу про запит підписки. Раніше тут читали user_roles
      // (роль manager) — RLS віддає репетитору лише ВЛАСНУ роль, тож список був
      // порожній і сповіщення ніколи не йшло. notify_managers (DEFINER) сам знає,
      // кому: незалежний → суперадмін платформи; хабовий → менеджери його школи.
      const tutorName = user?.email?.split("@")[0] ?? t("shared.tutor");
      // Запасний шлях: основне сповіщення створює тригер бази з тим самим типом.
      void notifyManagers({
        type: requestNotificationType("pro_request", requestId),
        title: t("notifications.proRequestTitle", { name: tutorName }),
        body: billingNote,
        link: "/subscription-requests",
      });
      setMessage("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const plans: { v: Billing; id: string; title: string; line: string; badge?: string }[] = [
    { v: "yearly", id: "bill-yearly", title: t("subscriptionDialog.yearly"), badge: "−20%",
      line: t("subscriptionDialogExtra.planLine", { perMonth: priceLabel("yearly"), total: totalLabel("yearly"), off: PLAN_DISCOUNT.yearly }) },
    { v: "halfyear", id: "bill-halfyear", title: t("subscriptionDialog.halfyear"),
      line: t("subscriptionDialogExtra.planLine", { perMonth: priceLabel("halfyear"), total: totalLabel("halfyear"), off: PLAN_DISCOUNT.halfyear }) },
    { v: "monthly", id: "bill-monthly", title: t("subscriptionDialog.monthly"),
      line: t("subscriptionDialogExtra.perMonth", { price: priceLabel("monthly") }) },
  ];

  // 14.11, хвиля форм: оболонка, підписи й поле — з канону. Плани, ціни й запис заявки — без змін.
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      locked={submitting}
      testId="subscription-request"
      title={<span className="inline-flex items-center gap-2"><Crown aria-hidden className="h-5 w-5 text-primary" />{t("subscriptionDialog.title")}</span>}
      description={t("subscriptionDialog.requestDescription")}
      footer={
        <>
          <SheetButton kind="secondary" onClick={() => onOpenChange(false)}>{t("common.close")}</SheetButton>
          {!existingPending && (
            <SheetButton onClick={submit} busy={submitting} disabled={checking}>{t("subscriptionDialog.submit")}</SheetButton>
          )}
        </>
      }
    >
      {checking ? (
        <div className="flex items-center justify-center py-6" aria-busy="true">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : existingPending ? (
        <div className="rounded-[13px] border border-success/30 bg-success/5 p-4">
          <div className="mb-1 inline-flex items-center gap-2 text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-[16px] font-semibold">{t("subscriptionDialog.alreadySent")}</span>
          </div>
          <p className="text-[14px] text-muted-foreground" style={{ lineHeight: 1.4 }}>{t("subscriptionDialog.alreadySentDesc")}</p>
        </div>
      ) : (
        <>
          <div>
            <FieldLabel id="bill-label">{t("subscriptionDialog.periodLabel")}</FieldLabel>
            <RadioGroup
              aria-labelledby="bill-label"
              value={billing}
              onValueChange={(v) => setBilling(v as Billing)}
              className="grid grid-cols-1 gap-2"
            >
              {plans.map((pl) => (
                <label
                  key={pl.v}
                  htmlFor={pl.id}
                  className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-[13px] border-[1.5px] px-3.5 py-3"
                  style={billing === pl.v
                    ? { background: "var(--teal-l)", borderColor: "var(--teal)" }
                    : { background: "var(--ds-surface2)", borderColor: "var(--ds-border)" }}
                >
                  <RadioGroupItem id={pl.id} value={pl.v} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[16px] font-semibold text-foreground">{pl.title}</span>
                      {pl.badge && (
                        <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[14px] font-semibold text-success">{pl.badge}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[14px] text-muted-foreground" style={{ lineHeight: 1.4 }}>{pl.line}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div>
            <FieldLabel htmlFor="msg">{t("subscriptionDialog.msgLabel")}</FieldLabel>
            <Textarea
              id="msg"
              placeholder={t("subscriptionDialog.msgPlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={1000}
              className={AREA_CLASS}
            />
          </div>
        </>
      )}
    </FormSheet>
  );
}
