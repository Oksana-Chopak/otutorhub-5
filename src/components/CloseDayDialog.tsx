import { useEffect, useMemo, useState } from "react";
import { updateLessonDetailsSafe } from "@/lib/lessonDetailsSafe";
import { logEvent } from "@/lib/analytics";
import { createNextWeekLessons } from "@/lib/nextWeekBulk";
import { bumpDataVersion } from "@/lib/dataBus";
import { useNavigate } from "react-router-dom";
import { NextStepBar } from "@/components/NextStepBar";
import { useLessonStatus } from "@/hooks/useLessonStatus";
import { completeLessons } from "@/lib/lessonActions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, X, Check } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { useTranslation } from "react-i18next";
import { useHaptic } from "@/hooks/useHaptic";
import { burstConfetti } from "@/lib/confetti";

export interface CloseDayRow {
  id: string;
  student_id?: string;
  name: string;
  time: string; // "18:00"
  /** B-D3: для «Запланувати наступні одним тапом» */
  starts_at: string;
  subject: string;
  duration_minutes?: number | null;
  source?: string | null;
  tutor_id: string;
  price: number;
  currency?: string | null;
  paid: boolean;
  /** MON-2: hub tutors must not see/write the student payment side — their masked
   * price reads 0 and the paid-write is a server-side no-op. false hides the price
   * line + ₴ pill and skips the payment write; default true. */
  showPay?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: CloseDayRow[];
  onDone?: () => void;
}

const C = {
  teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9", txt: "var(--ds-txt,#0f0f1a)",
  sub: "var(--sub,#666b82)", muted: "var(--ds-muted,#6f7489)", border: "var(--ds-border,#eceef3)", bg: "var(--ds-bg,#F5F4F0)",
  gold: "#9a6a12", goldBg: "rgba(245,181,68,.16)", goldRing: "rgba(245,181,68,.4)",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

/** Evening batch: mark today's past lessons completed + paid in one move. */
const Pill = ({ on, label, gold, onClick }: { on: boolean; label: string; gold?: boolean; onClick: () => void }) => (
  <button className="tap-44" type="button" onClick={onClick}
    style={{
      height: 36, padding: "0 12px", borderRadius: 999, cursor: "pointer",
      fontFamily: C.display, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap",
      border: `1.5px solid ${on ? (gold ? C.goldRing : C.teal) : C.border}`,
      background: on ? (gold ? C.goldBg : C.tealL) : "#fff",
      color: on ? (gold ? C.gold : C.tealD) : C.muted,
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>
    {on && <Check size={14} strokeWidth={2.6} />}{label}
  </button>
);

export function CloseDayDialog({ open, onOpenChange, rows, onDone }: Props) {
  const { t } = useTranslation();
  const haptic = useHaptic();
  const { user } = useAuth();
  const [state, setState] = useState<Record<string, { done: boolean; paid: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [packMap, setPackMap] = useState<Record<string, number>>({});

  // 📦 Залишок передплачених пакетів — інформаційно
  useEffect(() => {
    if (!open || !user) return;
    const ids = Array.from(new Set(rows.map((r) => r.student_id).filter(Boolean))) as string[];
    if (!ids.length) { setPackMap({}); return; }
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("student_wallet_balances")
          .select("student_id, lessons_balance")
          .eq("tutor_id", user.id)
          .in("student_id", ids);
        const m: Record<string, number> = {};
        ((data ?? []) as any[]).forEach((b: any) => { m[b.student_id] = Number(b.lessons_balance ?? 0); });
        setPackMap(m);
      } catch { setPackMap({}); }
    })();
  }, [open, user, rows]);

  // A6: скидаємо галочки лише коли реально змінився НАБІР уроків (або діалог
  // перевідкрили), а не коли батько перерендерився і масив отримав нову
  // ідентичність — раніше зняту галочку «оплачено» тихо повертало назад.
  const rowsKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (open) {
      const init: Record<string, { done: boolean; paid: boolean }> = {};
      rows.forEach((r) => { init[r.id] = { done: true, paid: true }; });
      setState(init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows навмисно через rowsKey
  }, [open, rowsKey]);

  const doneCount = useMemo(() => rows.filter((r) => state[r.id]?.done).length, [rows, state]);

  const { completeMany: flowCompleteMany } = useLessonStatus();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"form" | "summary" | "plan">("form");
  const [planChecked, setPlanChecked] = useState<Record<string, boolean>>({});
  const [planBusy, setPlanBusy] = useState(false);
  const [doneStat, setDoneStat] = useState<{ count: number; student: string | null }>({ count: 0, student: null });
  const apply = async () => {
    setBusy(true);
    try {
      const doneRows = rows.filter((r) => state[r.id]?.done);
      const doneIds = doneRows.map((r) => r.id);
      if (doneIds.length) {
        const ok = await flowCompleteMany(
          doneRows.map((r) => ({ id: r.id, student_id: r.student_id ?? null })),
          { toastText: t("closeDayDialog.dayClosedToast", { count: doneIds.length }) },
        );
        if (!ok) throw new Error("close-day-failed");
      }
      const paidRows = rows.filter((r) => r.showPay !== false && state[r.id]?.done && state[r.id]?.paid && !r.paid);
      // B1: updateLessonDetailsSafe повертає {error}, не кидає — Promise.all тут
      // НІКОЛИ не відхиляється. Раніше три провалені записи оплат з п'яти все
      // одно отримували конфеті, і репетитор дізнавався про це при звірці.
      const payResults = await Promise.all(
        paidRows.map((r) =>
          updateLessonDetailsSafe(r.id, { student_payment_status: "paid" })
        )
      );
      const failedPays = payResults.filter((r) => r.error).length;
      if (failedPays > 0) {
        haptic.error();
        toast.error(
          t("closeDayDialog.paymentsPartialError", { failed: failedPays, total: paidRows.length })
        );
        bumpDataVersion(); // C3: список перечитається — незаписані оплати видно одразу
        onDone?.();
        return; // без святкування: день НЕ закрито чисто
      }
      // B5: не тупик — показуємо підсумок дня з двома наступними діями.
      setDoneStat({ count: doneIds.length, student: doneRows[0]?.student_id ?? null });
      setPhase("summary");
      bumpDataVersion(); // C3
      onDone?.();
    } catch (e: any) {
      haptic.error();
      toast.error(t("closeDayDialog.closeDayError"), { description: e?.message });
    } finally {
      setBusy(false);
    }
  };


  const planRows = rows.filter((r) => r.student_id);
  const planCount = planRows.filter((r) => planChecked[r.id]).length;
  const createAllNext = async () => {
    const chosen = planRows.filter((r) => planChecked[r.id]);
    if (!chosen.length || planBusy) return;
    setPlanBusy(true);
    try {
      const { count, error } = await createNextWeekLessons(
        chosen.map((r) => ({ id: r.id, student_id: r.student_id!, tutor_id: r.tutor_id, subject: r.subject, starts_at: r.starts_at, duration_minutes: r.duration_minutes, source: r.source, price: r.price })),
        user!.id,
      );
      setPlanBusy(false);
      if (error) { toast.error(t("onboardingFlowB.saveFailed")); return; }
      toast.success(t("closeDaySummary.createdBulk", { count }));
      logEvent("bulk_next_created", { count }); // C6
      bumpDataVersion(); // C3
      setPhase("form");
      onOpenChange(false);
      onDone?.();
    } finally {
      setPlanBusy(false);
    }
  };

  if (phase === "plan") {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) setPhase("form"); onOpenChange(v); }}>
        <DialogContent className="max-w-[420px] rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto">
        {/* C3: VoiceOver казав просто «діалог» — тепер діалог названо */}
        <DialogTitle className="sr-only">{t("closeDayDialog.title")}</DialogTitle>
          <div className="flex flex-col gap-3 py-1">
            <p style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{t("closeDaySummary.planTitle")}</p>
            <div style={{ borderRadius: 16, border: "1px solid var(--border,var(--ds-border,#eceef3))", overflow: "hidden" }}>
              {planRows.map((r) => {
                const next = new Date(r.starts_at); next.setDate(next.getDate() + 7); // DST-безпечно
                return (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border,var(--ds-border,#eceef3))", cursor: "pointer" }}>
                    <input type="checkbox" checked={planChecked[r.id] ?? false}
                      onChange={(e) => setPlanChecked((p) => ({ ...p, [r.id]: e.target.checked }))}
                      style={{ width: 18, height: 18, accentColor: "#2BBFAA" }} />
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15 }}>{r.name}</span>
                    <span style={{ fontSize: 14, color: "var(--sub,#666b82)", flexShrink: 0 }}>
                      {next.toLocaleDateString(undefined, { weekday: "short" })} {r.time}
                    </span>
                  </label>
                );
              })}
            </div>
            <button type="button" disabled={planCount === 0 || planBusy} onClick={() => void createAllNext()}
              style={{ height: 52, borderRadius: 14, border: "none", cursor: planCount && !planBusy ? "pointer" : "default", opacity: planCount && !planBusy ? 1 : 0.5, background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#04302a", fontWeight: 800, fontSize: 16 }}>
              {planBusy ? "…" : t("closeDaySummary.createAll", { count: planCount })}
            </button>
            <button type="button" onClick={() => setPhase("summary")}
              style={{ height: 40, borderRadius: 12, border: "none", background: "transparent", color: "var(--sub,#666b82)", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              {t("closeDaySummary.back")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (phase === "summary") {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) setPhase("form"); onOpenChange(v); }}>
        <DialogContent className="max-w-[420px] rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto">
          <div className="flex flex-col gap-3 py-1">
            <p style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{t("closeDaySummary.title")}</p>
            <p style={{ fontSize: 14, color: "var(--sub,#666b82)", margin: 0 }}>
              {t("closeDaySummary.subtitle", { count: doneStat.count })}
            </p>
            <NextStepBar icon="✍️"
              text={t("closeDaySummary.writeSummaries", { count: doneStat.count })}
              actionLabel={t("nextStep.openSummary")}
              onAction={() => { setPhase("form"); onOpenChange(false); navigate("/schedule"); }} />
            <NextStepBar icon="📅"
              text={t("closeDaySummary.planNext", { count: doneStat.count })}
              actionLabel={t("nextStep.createNext")}
              onAction={() => {
                // B-D3: не deep-link на одну пару, а масовий крок по ВСІХ парах дня.
                setPlanChecked(Object.fromEntries(rows.filter((r) => r.student_id).map((r) => [r.id, true])));
                setPhase("plan");
              }} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[460px] p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: C.display, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", color: C.txt }}>{t("closeDayDialog.title")}</div>
            <div style={{ fontSize: 15, color: C.sub, marginTop: 2 }}>{t("closeDayDialog.subtitle")}</div>
          </div>
          <button onClick={() => onOpenChange(false)} aria-label={t("common.close")}
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: C.bg, color: C.sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>

        {/* Rows */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 20px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.map((r) => {
            const st = state[r.id] ?? { done: true, paid: true };
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 16, border: `1.5px solid ${st.done ? C.teal : C.border}`, background: st.done ? "rgba(43,191,170,.05)" : "#fff", opacity: st.done ? 1 : 0.7 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 15, color: C.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.time} · {r.name}
                  </div>
                  {r.showPay !== false && (
                    <div style={{ fontSize: 14, color: C.sub, marginTop: 1 }}>
                      {formatPrice(r.price, r.currency)}
                      {r.student_id && (packMap[r.student_id] ?? 0) > 0 && (
                        <span style={{ marginLeft: 6, color: C.tealD, fontFamily: C.display, fontWeight: 700 }}>{t("closeDayDialog.packageBalance", { count: packMap[r.student_id] })}</span>
                      )}
                    </div>
                  )}
                </div>
                <Pill on={st.done} label={t("closeDayDialog.conductedPill")} onClick={() => setState((s) => ({ ...s, [r.id]: { ...st, done: !st.done } }))} />
                {r.showPay !== false && (
                  <Pill on={st.done && (st.paid || r.paid)} gold label="💰"
                    onClick={() => st.done && !r.paid && setState((s) => ({ ...s, [r.id]: { ...st, paid: !st.paid } }))} />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: "14px 20px 20px", borderTop: `1px solid ${C.border}`, background: "var(--ds-surface,#fff)", display: "flex", gap: 10 }}>
          <button type="button" onClick={() => onOpenChange(false)}
            style={{ height: 52, padding: "0 18px", borderRadius: 14, border: `1px solid ${C.border}`, background: "var(--ds-surface,#fff)", color: C.sub, fontFamily: C.display, fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
            {t("closeDayDialog.cancel")}
          </button>
          <button type="button" onClick={apply} disabled={busy || doneCount === 0}
            style={{ flex: 1, height: 52, borderRadius: 14, border: "none", cursor: busy || doneCount === 0 ? "not-allowed" : "pointer",
              background: doneCount === 0 ? "rgba(43,191,170,.35)" : "linear-gradient(135deg,#2BBFAA,#25a896)",
              color: "#0f0f1a", fontFamily: C.display, fontWeight: 700, fontSize: 16,
              boxShadow: doneCount === 0 ? "none" : "0 8px 20px -8px rgba(43,191,170,.6)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            {t("closeDayDialog.submit")}{doneCount > 0 ? ` (${doneCount})` : ""}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CloseDayDialog;
