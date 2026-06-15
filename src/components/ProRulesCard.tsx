import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { Loader2, Check, Lock, Info, SlidersHorizontal, ChevronDown } from "lucide-react";
import { toast } from "sonner";
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

// ── Design tokens (DS — variant C "Обери політику") ───────────────────────────
const C = {
  txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3", bg: "#F5F4F0",
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
    setState({
      payment_reminder_enabled: (settings as unknown as Record<string, unknown>).payment_reminder_enabled as boolean ?? true,
      payment_due_mode: ((settings as unknown as Record<string, unknown>).payment_due_mode as PaymentMode) ?? "before_lesson",
      payment_due_days: (settings as unknown as Record<string, unknown>).payment_due_days as number ?? 1,
      cancel_free_hours: (settings as unknown as Record<string, unknown>).cancel_free_hours as number ?? 24,
      cancel_fee_percent: ((settings as unknown as Record<string, unknown>).cancel_fee_percent as FeePercent) ?? 0,
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
    { k: "flex", emoji: "🌿", title: t("proRulesCard.presetFlexTitle") || "Гнучка", desc: t("proRulesCard.presetFlexDesc") || "Безкоштовно за 6 год · пізніше 0% · м'яко до учнів", hours: 6, fee: 0 },
    { k: "standard", emoji: "⚖️", title: t("proRulesCard.presetStandardTitle") || "Стандартна", desc: t("proRulesCard.presetStandardDesc") || "Безкоштовно за 24 год · пізніше 50%", hours: 24, fee: 50 },
    { k: "strict", emoji: "🔒", title: t("proRulesCard.presetStrictTitle") || "Сувора", desc: t("proRulesCard.presetStrictDesc") || "Безкоштовно за 48 год · пізніше 100%", hours: 48, fee: 100 },
  ];
  const activePreset = PRESETS.find((p) => p.hours === state.cancel_free_hours && p.fee === state.cancel_fee_percent) ?? null;

  const applyPreset = (p: Preset) => {
    if (disabled) return;
    setState((s) => s && { ...s, cancel_free_hours: p.hours, cancel_fee_percent: p.fee });
  };

  const set = <K extends keyof RulesState>(k: K, v: RulesState[K]) =>
    setState((s) => s && { ...s, [k]: v });

  const summaryText = () => {
    const feeTxt = state.cancel_fee_percent === 0
      ? t("proRulesCard.summaryFeeFree")
      : t("proRulesCard.summaryFeePaid", { percent: state.cancel_fee_percent });
    return t("proRulesCard.summaryText", { hours: state.cancel_free_hours, feeTxt });
  };

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
          <div style={{ fontFamily: C.display, fontWeight: 800, fontSize: 19, letterSpacing: "-.01em" }}>
            {t("proRulesCard.title")}
          </div>
          <button onClick={() => setInfoOpen((v) => !v)} type="button" aria-label={t("proRulesCard.moreInfo")}
            style={{ width: 24, height: 24, borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: infoOpen ? C.teal : C.muted, flexShrink: 0 }}>
            <Info className="h-4 w-4" />
          </button>
        </div>
        {disabled && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: C.sub, flexShrink: 0 }}>
            <Lock className="h-3 w-3" /> {t("proRulesCard.availableInPro")}
          </span>
        )}
      </div>
      {infoOpen && (
        <p style={{ fontSize: 13, lineHeight: 1.5, borderRadius: 10, padding: "8px 12px", marginBottom: 4, background: "rgba(43,191,170,.07)", color: C.sub, border: "1px solid rgba(43,191,170,.15)" }}>
          {t("proRulesCard.description")}
        </p>
      )}
      <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.45, margin: "6px 0 16px" }}>
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
                  <span style={{ fontFamily: C.display, fontWeight: 800, fontSize: 16 }}>{p.title}</span>
                  {on && <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "2px 9px", fontFamily: C.display, fontWeight: 700, fontSize: 13, background: "rgba(43,191,170,.12)", color: C.tealD, boxShadow: `inset 0 0 0 1px ${C.tealRing}` }}>{t("proRulesCard.chosen") || "Обрано"}</span>}
                </div>
                <div style={{ fontSize: 13, color: C.sub, marginTop: 2, lineHeight: 1.4 }}>{p.desc}</div>
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
        <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".08em", color: C.tealD, fontFamily: C.display, fontWeight: 700 }}>
          {t("proRulesCard.summary") || "Підсумок"}{activePreset ? ` · ${activePreset.title}` : ` · ${t("proRulesCard.custom") || "Власні"}`}
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 8 }}>{summaryText()}</div>
      </div>

      {/* Fine-tune toggle */}
      <button onClick={() => setTuneOpen((v) => !v)} type="button" disabled={disabled}
        style={{ marginTop: 14, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "13px 14px", borderRadius: 14, cursor: disabled ? "default" : "pointer", border: `1.5px solid ${C.border}`, background: C.surface }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SlidersHorizontal size={18} style={{ color: C.tealD }} />
          <span style={{ fontFamily: C.display, fontWeight: 700, fontSize: 14 }}>{t("proRulesCard.fineTune") || "Тонке налаштування"}</span>
        </span>
        <ChevronDown size={18} style={{ color: C.muted, transform: tuneOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>

      {tuneOpen && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 18, opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? "none" : "auto" }}>
          {/* Free window */}
          <div>
            <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 14.5 }}>{t("proRulesCard.freeWindow") || "Безкоштовне вікно"}</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 1, marginBottom: 9 }}>{t("proRulesCard.freeWindowHint") || "За скільки годин до уроку можна скасувати безкоштовно"}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[6, 12, 24, 48].map((h) => {
                const on = state.cancel_free_hours === h;
                return (
                  <button key={h} onClick={() => set("cancel_free_hours", h)} type="button"
                    style={{ flex: 1, height: 42, borderRadius: 12, cursor: "pointer", fontFamily: C.display, fontWeight: 700, fontSize: 14,
                      border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? C.tealL : C.surface, color: on ? C.tealD : C.txt }}>
                    {h} {t("proRulesCard.hoursShort") || "год"}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Input type="number" min={0} max={168} value={state.cancel_free_hours}
                onChange={(e) => set("cancel_free_hours", Number(e.target.value) || 0)}
                className="w-20 h-9" style={{ borderRadius: 10 }} />
              <span style={{ fontSize: 13, color: C.sub }}>{t("proRulesCard.hoursBeforeLesson")}</span>
            </div>
          </div>

          {/* Late fee */}
          <div>
            <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 14.5 }}>{t("proRulesCard.lateCancelLabel")}</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 1, marginBottom: 9 }}>
              {t("proRulesCard.lateCancelHint", { hours: state.cancel_free_hours, percent: state.cancel_fee_percent })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {([0, 10, 25, 50, 100] as FeePercent[]).map((p) => {
                const on = state.cancel_fee_percent === p;
                return (
                  <button key={p} onClick={() => set("cancel_fee_percent", p)} type="button"
                    style={{ flex: 1, height: 40, borderRadius: 11, cursor: "pointer", fontFamily: C.display, fontWeight: 700, fontSize: 13.5,
                      border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? "rgba(43,191,170,.1)" : C.surface, color: on ? C.tealD : C.txt }}>
                    {p === 0 ? (t("proRulesCard.off") || "Off") : `${p}%`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: C.border }} />

          {/* Payment reminders */}
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 14.5 }}>{t("proRulesCard.reminderLabel")}</div>
                <div style={{ fontSize: 13, color: C.sub, marginTop: 1, lineHeight: 1.4 }}>{t("proRulesCard.reminderHint")}</div>
              </div>
              <Switch checked={state.payment_reminder_enabled} disabled={disabled}
                onCheckedChange={(v) => set("payment_reminder_enabled", v)} />
            </div>

            {state.payment_reminder_enabled && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{t("proRulesCard.paymentDueLabel")}</div>
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
                          <span style={{ display: "block", fontFamily: C.display, fontWeight: 700, fontSize: 13.5, color: on ? C.tealD : C.txt }}>{opt.title}</span>
                          <span style={{ display: "block", fontSize: 13, color: C.sub, marginTop: 1 }}>{opt.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {state.payment_due_mode !== "prepaid" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                    <span style={{ fontSize: 13, color: C.sub }}>
                      {state.payment_due_mode === "before_lesson" ? t("proRulesCard.daysBefore") : t("proRulesCard.daysAfter")}
                    </span>
                    <Input type="number" min={0} max={30} value={state.payment_due_days}
                      onChange={(e) => set("payment_due_days", Number(e.target.value) || 0)}
                      className="w-20 h-9" style={{ borderRadius: 10 }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save */}
      <button onClick={save} disabled={disabled || saving} type="button"
        style={{ marginTop: 18, width: "100%", height: 52, borderRadius: 14, border: "none", color: "#0f0f1a",
          background: C.gradTeal, fontFamily: C.display, fontWeight: 700, fontSize: 16,
          cursor: disabled || saving ? "default" : "pointer", opacity: disabled || saving ? 0.7 : 1,
          boxShadow: C.shadowTeal, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check size={18} />}
        {t("proRulesCard.saveBtn")}
      </button>
    </div>
  );
}
