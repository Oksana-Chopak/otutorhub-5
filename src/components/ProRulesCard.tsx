import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Loader2, Check, Lock, Info, SlidersHorizontal, ChevronDown, Send, Mail, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type PaymentMode = "prepaid" | "before_lesson" | "after_lesson";
type FeePercent = 0 | 50 | 100;
type NoShowPercent = 50 | 100;

interface RulesState {
  payment_reminder_enabled: boolean;
  payment_due_mode: PaymentMode;
  payment_due_days: number;
  cancel_free_hours: number;
  cancel_fee_percent: FeePercent;
  noshow_charge: NoShowPercent;
  free_reschedules_per_month: number;
  notify_telegram: boolean;
  notify_email: boolean;
}

// ── Design tokens (DS — variant C "Обери політику") ───────────────────────────
const C = {
  txt: "#0f0f1a", sub: "var(--sub,#6b7088)", muted: "#b0b4c8", border: "#eceef3", bg: "#F5F4F0",
  surface: "#FFFFFF", teal: "#2BBFAA", tealD: "#1f8e7e", tealL: "#f0fdf9",
  tealRing: "rgba(43,191,170,.28)", successD: "#16a34a", warningD: "#B4740B", coral: "#e0552f",
  gradTeal: "linear-gradient(135deg,#2BBFAA,#25a896)",
  shadowSm: "0 1px 4px rgba(15,15,26,.05)", shadowTeal: "0 8px 20px -8px rgba(43,191,170,.6)",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

interface Preset {
  k: string;
  emoji: string;
  title: string;
  desc: string;
  hours: number;
  fee: FeePercent;
  noshow: NoShowPercent;
  resched: number;
}

export function ProRulesCard() {
  const { t } = useTranslation();
  const { settings, isPro, isTrial, updateSettings, loading } = useWorkspaceSettings();
  const [state, setState] = useState<RulesState | null>(null);
  const [saving, setSaving] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const raw = settings as unknown as Record<string, unknown>;
    // Reconcile any legacy late-fee value (0/10/25/50/100) to the spec's 3 options.
    const rawFee = (raw.cancel_fee_percent as number) ?? 0;
    const fee: FeePercent = rawFee >= 75 ? 100 : rawFee >= 25 ? 50 : 0;
    const rawNoshow = (raw.noshow_charge as number) ?? 100;
    const noshow: NoShowPercent = rawNoshow <= 50 ? 50 : 100;
    setState({
      payment_reminder_enabled: raw.payment_reminder_enabled as boolean ?? true,
      payment_due_mode: (raw.payment_due_mode as PaymentMode) ?? "before_lesson",
      payment_due_days: raw.payment_due_days as number ?? 1,
      cancel_free_hours: raw.cancel_free_hours as number ?? 24,
      cancel_fee_percent: fee,
      noshow_charge: noshow,
      free_reschedules_per_month: Math.max(0, (raw.free_reschedules_per_month as number) ?? 0),
      notify_telegram: raw.notify_telegram as boolean ?? true,
      notify_email: raw.notify_email as boolean ?? false,
    });
  }, [settings]);

  if (loading || !state) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: C.muted }} />
      </div>
    );
  }

  const disabled = !isPro && !isTrial;

  const PRESETS: Preset[] = [
    { k: "flex", emoji: "🌿", title: t("proRulesCard.presetFlexTitle"), desc: t("proRulesCard.presetFlexDesc"), hours: 6, fee: 0, noshow: 50, resched: 3 },
    { k: "standard", emoji: "⚖️", title: t("proRulesCard.presetStandardTitle"), desc: t("proRulesCard.presetStandardDesc"), hours: 24, fee: 100, noshow: 100, resched: 2 },
    { k: "strict", emoji: "🔒", title: t("proRulesCard.presetStrictTitle"), desc: t("proRulesCard.presetStrictDesc"), hours: 48, fee: 100, noshow: 100, resched: 0 },
  ];
  const activePreset = PRESETS.find((p) =>
    p.hours === state.cancel_free_hours &&
    p.fee === state.cancel_fee_percent &&
    p.noshow === state.noshow_charge &&
    p.resched === state.free_reschedules_per_month,
  ) ?? null;

  const applyPreset = (p: Preset) => {
    if (disabled) return;
    setState((s) => s && {
      ...s,
      cancel_free_hours: p.hours,
      cancel_fee_percent: p.fee,
      noshow_charge: p.noshow,
      free_reschedules_per_month: p.resched,
    });
  };

  const set = <K extends keyof RulesState>(k: K, v: RulesState[K]) =>
    setState((s) => s && { ...s, [k]: v });

  const summaryText = () => {
    const feeTxt = state.cancel_fee_percent === 0
      ? t("proRulesCard.summaryFeeFree")
      : t("proRulesCard.summaryFeePaid", { percent: state.cancel_fee_percent });
    const base = t("proRulesCard.summaryText", { hours: state.cancel_free_hours, feeTxt });
    const noshow = state.noshow_charge === 100
      ? t("proRulesCard.summaryNoshowFull")
      : t("proRulesCard.summaryNoshowHalf");
    const resched = t("proRulesCard.summaryReschedules", { count: state.free_reschedules_per_month });
    const notify = state.notify_telegram || state.notify_email
      ? t("proRulesCard.summaryNotify", {
          channels: state.notify_telegram && state.notify_email
            ? t("proRulesCard.channelsBoth")
            : state.notify_telegram
              ? t("proRulesCard.channelTelegram")
              : t("proRulesCard.channelEmail"),
        })
      : t("proRulesCard.summaryNotifyOff");
    return `${base} ${noshow} ${resched} ${notify}`;
  };

  const save = async () => {
    setSaving(true);
    const days = Math.max(0, Math.min(30, state.payment_due_days || 0));
    const hours = Math.max(0, Math.min(168, state.cancel_free_hours || 0));
    const reschedules = Math.max(0, Math.min(31, state.free_reschedules_per_month || 0));
    const error = await updateSettings({
      payment_reminder_enabled: state.payment_reminder_enabled,
      payment_due_mode: state.payment_due_mode,
      payment_due_days: days,
      cancel_free_hours: hours,
      cancel_fee_percent: state.cancel_fee_percent,
      noshow_charge: state.noshow_charge,
      free_reschedules_per_month: reschedules,
      notify_telegram: state.notify_telegram,
      notify_email: state.notify_email,
      payment_rules_configured: true,
    } as never);
    setSaving(false);
    if (error) {
      toast.error(t("proRulesCard.saveFailed"), { description: (error as { message?: string }).message });
      return;
    }
    toast.success(t("proRulesCard.saveSuccess"));
  };

  return (
    <div style={{ fontFamily: C.body, color: C.txt, padding: "8px 20px 24px", opacity: disabled ? 0.92 : 1 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ fontFamily: C.display, fontWeight: 800, fontSize: 17, letterSpacing: "-.01em" }}>
            {t("proRulesCard.title")}
          </div>
          <button onClick={() => setInfoOpen((v) => !v)} type="button" aria-label={t("proRulesCard.moreInfo")} aria-expanded={infoOpen}
            style={{ width: 24, height: 24, borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: infoOpen ? C.teal : C.muted, flexShrink: 0 }}>
            <Info className="h-4 w-4" />
          </button>
        </div>
        {disabled && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 14, color: C.sub, flexShrink: 0 }}>
            <Lock className="h-3 w-3" /> {t("proRulesCard.availableInPro")}
          </span>
        )}
      </div>
      {infoOpen && (
        <p style={{ fontSize: 14, lineHeight: 1.5, borderRadius: 12, padding: "8px 12px", marginBottom: 4, background: "rgba(43,191,170,.07)", color: C.sub, border: "1px solid rgba(43,191,170,.15)" }}>
          {t("proRulesCard.description")}
        </p>
      )}
      <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.45, margin: "6px 0 16px" }}>
        {t("proRulesCard.intro") || "Почни з готового шаблону — потім можна тонко налаштувати під себе."}
      </p>

      {/* Presets */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? "none" : "auto" }}>
        {PRESETS.map((p) => {
          const on = activePreset?.k === p.k;
          return (
            <button key={p.k} onClick={() => applyPreset(p)} type="button"
              style={{ display: "flex", alignItems: "center", gap: 13, textAlign: "left", padding: 14, borderRadius: 18, cursor: "pointer",
                border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? C.tealL : C.surface, boxShadow: on ? "none" : C.shadowSm }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: on ? "#fff" : C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{p.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: C.display, fontWeight: 800, fontSize: 17 }}>{p.title}</span>
                  {on && <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "2px 9px", fontFamily: C.display, fontWeight: 700, fontSize: 14, background: "rgba(43,191,170,.12)", color: C.tealD, boxShadow: `inset 0 0 0 1px ${C.tealRing}` }}>{t("proRulesCard.chosen") || "Обрано"}</span>}
                </div>
                <div style={{ fontSize: 14, color: C.sub, marginTop: 2, lineHeight: 1.4 }}>{p.desc}</div>
              </div>
              <span style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, border: `2px solid ${on ? C.teal : C.muted}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {on && <span style={{ width: 11, height: 11, borderRadius: 999, background: C.teal }} />}
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{ marginTop: 14, borderRadius: 16, padding: 16, background: "rgba(43,191,170,.06)", border: `1px solid ${C.tealRing}` }}>
        <div style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".08em", color: C.tealD, fontFamily: C.display, fontWeight: 700 }}>
          {t("proRulesCard.summary") || "Підсумок"}{activePreset ? ` · ${activePreset.title}` : ` · ${t("proRulesCard.custom") || "Власні"}`}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.5, marginTop: 8 }}>{summaryText()}</div>
      </div>

      {/* Fine-tune toggle */}
      <button onClick={() => setTuneOpen((v) => !v)} type="button" disabled={disabled} aria-expanded={tuneOpen}
        style={{ marginTop: 14, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "13px 14px", borderRadius: 14, cursor: disabled ? "default" : "pointer", border: `1.5px solid ${C.border}`, background: C.surface }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: "rgba(43,191,170,.12)", color: C.tealD, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SlidersHorizontal size={18} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("proRulesCard.fineTune") || "Тонке налаштування"}</span>
            <span style={{ fontSize: 14, color: C.sub, marginTop: 1 }}>{t("proRulesCard.fineTuneSub") || "Зміни вікно, оплати й перенесення"}</span>
          </span>
        </span>
        <ChevronDown size={18} style={{ color: C.muted, transform: tuneOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>

      {tuneOpen && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 18, opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? "none" : "auto" }}>
          {/* Free window */}
          <div>
            <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("proRulesCard.freeWindow") || "Безкоштовне вікно"}</div>
            <div style={{ fontSize: 14, color: C.sub, marginTop: 1, marginBottom: 9 }}>{t("proRulesCard.freeWindowHint") || "За скільки годин до уроку можна скасувати безкоштовно"}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[6, 12, 24, 48].map((h) => {
                const on = state.cancel_free_hours === h;
                return (
                  <button key={h} onClick={() => set("cancel_free_hours", h)} type="button"
                    style={{ flex: 1, height: 48, borderRadius: 12, cursor: "pointer", fontFamily: C.display, fontWeight: 700, fontSize: 14,
                      border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? C.tealL : C.surface, color: on ? C.tealD : C.txt }}>
                    {h} {t("proRulesCard.hoursShort") || "год"}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Input type="number" min={0} max={168} value={state.cancel_free_hours}
                onChange={(e) => set("cancel_free_hours", Number(e.target.value) || 0)}
                className="w-20 h-11 text-[15px] rounded-[12px]" />
              <span style={{ fontSize: 14, color: C.sub }}>{t("proRulesCard.hoursBeforeLesson")}</span>
            </div>
          </div>

          {/* Late fee */}
          <div>
            <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("proRulesCard.lateCancelLabel")}</div>
            <div style={{ fontSize: 14, color: C.sub, marginTop: 1, marginBottom: 9 }}>
              {t("proRulesCard.lateCancelHint", { hours: state.cancel_free_hours, percent: state.cancel_fee_percent })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {([100, 50, 0] as FeePercent[]).map((p) => {
                const on = state.cancel_fee_percent === p;
                return (
                  <button key={p} onClick={() => set("cancel_fee_percent", p)} type="button"
                    style={{ flex: 1, height: 48, borderRadius: 12, cursor: "pointer", fontFamily: C.display, fontWeight: 700, fontSize: 14,
                      border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? "rgba(43,191,170,.1)" : C.surface, color: on ? C.tealD : C.txt }}>
                    {`${p}%`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* No-show */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("proRulesCard.noshowLabel")}</div>
              <div style={{ fontSize: 14, color: C.sub, marginTop: 1, lineHeight: 1.4 }}>{t("proRulesCard.noshowHint")}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {([100, 50] as NoShowPercent[]).map((p) => {
                const on = state.noshow_charge === p;
                return (
                  <button key={p} onClick={() => set("noshow_charge", p)} type="button"
                    style={{ minWidth: 56, height: 44, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontFamily: C.display, fontWeight: 700, fontSize: 14,
                      border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? "rgba(43,191,170,.1)" : C.surface, color: on ? C.tealD : C.txt }}>
                    {`${p}%`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Free reschedules per month */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("proRulesCard.reschedulesLabel")}</div>
              <div style={{ fontSize: 14, color: C.sub, marginTop: 1, lineHeight: 1.4 }}>{t("proRulesCard.reschedulesHint")}</div>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, overflow: "hidden", flexShrink: 0 }}>
              <button type="button" aria-label={t("proRulesCard.reschedulesDecrease")}
                onClick={() => set("free_reschedules_per_month", Math.max(0, state.free_reschedules_per_month - 1))}
                style={{ width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer", color: C.sub, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Minus size={18} />
              </button>
              <span style={{ minWidth: 36, textAlign: "center", fontFamily: C.display, fontWeight: 800, fontSize: 16 }}>{state.free_reschedules_per_month}</span>
              <button type="button" aria-label={t("proRulesCard.reschedulesIncrease")}
                onClick={() => set("free_reschedules_per_month", Math.min(31, state.free_reschedules_per_month + 1))}
                style={{ width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer", color: C.tealD, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Plus size={18} />
              </button>
            </div>
          </div>

          {/* Notify the student */}
          <div>
            <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("proRulesCard.notifyLabel")}</div>
            <div style={{ fontSize: 14, color: C.sub, marginTop: 1, marginBottom: 10, lineHeight: 1.4 }}>{t("proRulesCard.notifyHint")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 44 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: "rgba(34,158,217,.12)", color: "#229ED9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Send size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 15 }}>{t("proRulesCard.notifyTelegram")}</div>
                  <div style={{ fontSize: 14, color: C.sub, marginTop: 1 }}>{t("proRulesCard.notifyTelegramSub")}</div>
                </div>
                <Switch checked={state.notify_telegram} disabled={disabled}
                  onCheckedChange={(v) => set("notify_telegram", v)} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 44 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: "rgba(139,92,246,.12)", color: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Mail size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 15 }}>{t("proRulesCard.notifyEmail")}</div>
                  <div style={{ fontSize: 14, color: C.sub, marginTop: 1 }}>{t("proRulesCard.notifyEmailSub")}</div>
                </div>
                <Switch checked={state.notify_email} disabled={disabled}
                  onCheckedChange={(v) => set("notify_email", v)} />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: C.border }} />

          {/* Payment reminders */}
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16 }}>{t("proRulesCard.reminderLabel")}</div>
                <div style={{ fontSize: 14, color: C.sub, marginTop: 1, lineHeight: 1.4 }}>{t("proRulesCard.reminderHint")}</div>
              </div>
              <Switch checked={state.payment_reminder_enabled} disabled={disabled}
                onCheckedChange={(v) => set("payment_reminder_enabled", v)} />
            </div>

            {state.payment_reminder_enabled && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{t("proRulesCard.paymentDueLabel")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {([
                    { value: "prepaid" as PaymentMode, title: t("proRulesCard.prepaidTitle"), desc: t("proRulesCard.prepaidDesc") },
                    { value: "before_lesson" as PaymentMode, title: t("proRulesCard.beforeTitle"), desc: t("proRulesCard.beforeDesc") },
                    { value: "after_lesson" as PaymentMode, title: t("proRulesCard.afterTitle"), desc: t("proRulesCard.afterDesc") },
                  ]).map((opt) => {
                    const on = state.payment_due_mode === opt.value;
                    return (
                      <button key={opt.value} type="button" onClick={() => set("payment_due_mode", opt.value)}
                        style={{ display: "flex", alignItems: "flex-start", gap: 10, width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 12, cursor: "pointer",
                          border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? C.tealL : C.surface }}>
                        <span style={{ width: 18, height: 18, marginTop: 1, borderRadius: 999, flexShrink: 0, border: `2px solid ${on ? C.teal : C.muted}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {on && <span style={{ width: 9, height: 9, borderRadius: 999, background: C.teal }} />}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontFamily: C.display, fontWeight: 700, fontSize: 16, color: on ? C.tealD : C.txt }}>{opt.title}</span>
                          <span style={{ display: "block", fontSize: 14, color: C.sub, marginTop: 1 }}>{opt.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {state.payment_due_mode !== "prepaid" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                    <span style={{ fontSize: 14, color: C.sub }}>
                      {state.payment_due_mode === "before_lesson" ? t("proRulesCard.daysBefore") : t("proRulesCard.daysAfter")}
                    </span>
                    <Input type="number" min={0} max={30} value={state.payment_due_days}
                      onChange={(e) => set("payment_due_days", Number(e.target.value) || 0)}
                      className="w-20 h-11 text-[15px] rounded-[12px]" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save */}
      <button onClick={save} disabled={disabled || saving} type="button"
        style={{ marginTop: 18, width: "100%", height: 50, borderRadius: 14, border: "none", color: "#0f0f1a",
          background: C.gradTeal, fontFamily: C.display, fontWeight: 700, fontSize: 16,
          cursor: disabled || saving ? "default" : "pointer", opacity: disabled || saving ? 0.7 : 1,
          boxShadow: C.shadowTeal, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check size={18} />}
        {t("proRulesCard.saveBtn")}
      </button>
    </div>
  );
}
