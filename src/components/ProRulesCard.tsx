import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Loader2, Save, Settings2, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type PaymentMode = "prepaid" | "before_lesson" | "after_lesson";

type FeePercent = 0 | 10 | 25 | 50 | 100;

interface RulesState {
  payment_reminder_enabled: boolean;
  payment_due_mode: PaymentMode;
  payment_due_days: number;
  cancel_free_hours: number;
  cancel_fee_percent: FeePercent;
}

export function ProRulesCard() {
  const { t } = useTranslation();
  const { settings, isPro, updateSettings, loading } = useWorkspaceSettings();
  const [state, setState] = useState<RulesState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setState({
      payment_reminder_enabled: (settings as any).payment_reminder_enabled ?? true,
      payment_due_mode: ((settings as any).payment_due_mode ?? "before_lesson") as PaymentMode,
      payment_due_days: (settings as any).payment_due_days ?? 1,
      cancel_free_hours: (settings as any).cancel_free_hours ?? 24,
      cancel_fee_percent: ((settings as any).cancel_fee_percent ?? 0) as FeePercent,
    });
  }, [settings]);

  if (loading || !state) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const disabled = !isPro;

  const save = async () => {
    setSaving(true);
    const days = Math.max(0, Math.min(30, state.payment_due_days || 0));
    const hours = Math.max(0, Math.min(168, state.cancel_free_hours || 0));
    const error = await updateSettings({
      payment_reminder_enabled: state.payment_reminder_enabled,
      payment_due_mode: state.payment_due_mode,
      payment_due_days: days,
      cancel_free_hours: hours,
      cancel_fee_percent: state.cancel_fee_percent,
      payment_rules_configured: true,
    } as any);
    setSaving(false);
    if (error) {
      toast.error(t("proRulesCard.saveFailed"), { description: (error as any).message });
      return;
    }
    toast.success(t("proRulesCard.saveSuccess"));
  };

  return (
    <Card className={cn(disabled && "opacity-80")}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Settings2 className="h-4 w-4" />
            </div>
            <CardTitle className="text-base">{t("proRulesCard.title")}</CardTitle>
          </div>
          {disabled && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> {t("proRulesCard.availableInPro")}
            </span>
          )}
        </div>
        <CardDescription>
          {t("proRulesCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Reminders enabled */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="reminder-enabled" className="text-sm font-medium">
              {t("proRulesCard.reminderLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("proRulesCard.reminderHint")}
            </p>
          </div>
          <Switch
            id="reminder-enabled"
            checked={state.payment_reminder_enabled}
            disabled={disabled}
            onCheckedChange={(v) =>
              setState((s) => s && { ...s, payment_reminder_enabled: v })
            }
          />
        </div>

        {/* Payment due mode */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">{t("proRulesCard.paymentDueLabel")}</Label>
          <RadioGroup
            value={state.payment_due_mode}
            onValueChange={(v) =>
              setState((s) => s && { ...s, payment_due_mode: v as PaymentMode })
            }
            className="grid gap-2"
            disabled={disabled || !state.payment_reminder_enabled}
          >
            {[
              {
                value: "prepaid" as PaymentMode,
                title: t("proRulesCard.prepaidTitle"),
                desc: t("proRulesCard.prepaidDesc"),
              },
              {
                value: "before_lesson" as PaymentMode,
                title: t("proRulesCard.beforeTitle"),
                desc: t("proRulesCard.beforeDesc"),
              },
              {
                value: "after_lesson" as PaymentMode,
                title: t("proRulesCard.afterTitle"),
                desc: t("proRulesCard.afterDesc"),
              },
            ].map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition",
                  state.payment_due_mode === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                  (disabled || !state.payment_reminder_enabled) &&
                    "cursor-not-allowed opacity-60"
                )}
              >
                <RadioGroupItem value={opt.value} className="mt-0.5" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{opt.title}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </div>
              </label>
            ))}
          </RadioGroup>

          {state.payment_due_mode !== "prepaid" && (
            <div className="flex items-center gap-2">
              <Label htmlFor="due-days" className="text-sm text-muted-foreground">
                {state.payment_due_mode === "before_lesson"
                  ? t("proRulesCard.daysBefore")
                  : t("proRulesCard.daysAfter")}
              </Label>
              <Input
                id="due-days"
                type="number"
                min={0}
                max={30}
                value={state.payment_due_days}
                disabled={disabled || !state.payment_reminder_enabled}
                onChange={(e) =>
                  setState(
                    (s) => s && { ...s, payment_due_days: Number(e.target.value) || 0 }
                  )
                }
                className="w-24"
              />
            </div>
          )}
        </div>

        {/* Cancel free hours */}
        <div className="space-y-2">
          <Label htmlFor="cancel-hours" className="text-sm font-medium">
            {t("proRulesCard.freeCancelLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("proRulesCard.freeCancelHint")}
          </p>
          <div className="flex items-center gap-2">
            <Input
              id="cancel-hours"
              type="number"
              min={0}
              max={168}
              value={state.cancel_free_hours}
              disabled={disabled}
              onChange={(e) =>
                setState(
                  (s) => s && { ...s, cancel_free_hours: Number(e.target.value) || 0 }
                )
              }
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">{t("proRulesCard.hoursBeforeLesson")}</span>
          </div>
        </div>

        {/* Cancel fee percent */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            {t("proRulesCard.lateCancelLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("proRulesCard.lateCancelHint", { hours: state.cancel_free_hours, percent: state.cancel_fee_percent })}
            {state.cancel_fee_percent === 0 && t("proRulesCard.lateCancelDisabled")}
          </p>
          <div className="grid grid-cols-5 gap-2">
            {([0, 10, 25, 50, 100] as FeePercent[]).map((p) => (
              <button
                type="button"
                key={p}
                disabled={disabled}
                onClick={() =>
                  setState((s) => s && { ...s, cancel_fee_percent: p })
                }
                className={cn(
                  "rounded-md border px-2 py-2 text-sm font-medium transition",
                  state.cancel_fee_percent === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/40",
                  disabled && "cursor-not-allowed opacity-60"
                )}
              >
                {p === 0 ? "Off" : `${p}%`}
              </button>
            ))}
          </div>
        </div>

        <Button onClick={save} disabled={disabled || saving} className="w-full">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {t("proRulesCard.saveBtn")}
        </Button>
      </CardContent>
    </Card>
  );
}
