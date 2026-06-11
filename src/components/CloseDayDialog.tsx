import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, X, Check } from "lucide-react";
import { formatPrice } from "@/lib/currency";

export interface CloseDayRow {
  id: string;
  student_id?: string;
  name: string;
  time: string; // "18:00"
  price: number;
  currency?: string | null;
  paid: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: CloseDayRow[];
  onDone?: () => void;
}

const C = {
  teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9", txt: "#0f0f1a",
  sub: "#9398b0", muted: "#b0b4c8", border: "#eceef3", bg: "#F5F4F0",
  gold: "#9a6a12", goldBg: "rgba(245,181,68,.16)", goldRing: "rgba(245,181,68,.4)",
  display: "Inter, system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif",
};

/** Evening batch: mark today's past lessons completed + paid in one move. */
export function CloseDayDialog({ open, onOpenChange, rows, onDone }: Props) {
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

  useEffect(() => {
    if (open) {
      const init: Record<string, { done: boolean; paid: boolean }> = {};
      rows.forEach((r) => { init[r.id] = { done: true, paid: true }; });
      setState(init);
    }
  }, [open, rows]);

  const doneCount = useMemo(() => rows.filter((r) => state[r.id]?.done).length, [rows, state]);

  const apply = async () => {
    setBusy(true);
    try {
      const doneIds = rows.filter((r) => state[r.id]?.done).map((r) => r.id);
      if (doneIds.length) {
        const { error } = await supabase.from("lessons").update({ status: "completed" }).in("id", doneIds);
        if (error) throw error;
      }
      const paidRows = rows.filter((r) => state[r.id]?.done && state[r.id]?.paid && !r.paid);
      await Promise.all(
        paidRows.map((r) =>
          supabase
            .from("lesson_details")
            .upsert({ lesson_id: r.id, student_payment_status: "paid" }, { onConflict: "lesson_id" })
        )
      );
      toast.success(`🌙 День закрито — ${doneIds.length} ${doneIds.length === 1 ? "урок" : doneIds.length < 5 ? "уроки" : "уроків"}`);
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      toast.error("Не вдалося закрити день", { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const Pill = ({ on, label, gold, onClick }: { on: boolean; label: string; gold?: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      style={{
        height: 36, padding: "0 12px", borderRadius: 999, cursor: "pointer",
        fontFamily: C.display, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap",
        border: `1.5px solid ${on ? (gold ? C.goldRing : C.teal) : C.border}`,
        background: on ? (gold ? C.goldBg : C.tealL) : "#fff",
        color: on ? (gold ? C.gold : C.tealD) : C.muted,
        display: "inline-flex", alignItems: "center", gap: 5,
      }}>
      {on && <Check size={14} strokeWidth={2.6} />}{label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[460px] p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: C.display, fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", color: C.txt }}>🌙 Закрити день</div>
            <div style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>Відміть, що відбулось і що оплачено</div>
          </div>
          <button onClick={() => onOpenChange(false)} aria-label="✕"
            style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, border: "none", background: C.bg, color: C.sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.map((r) => {
            const st = state[r.id] ?? { done: true, paid: true };
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 16, border: `1.5px solid ${st.done ? C.teal : C.border}`, background: st.done ? "rgba(43,191,170,.05)" : "#fff", opacity: st.done ? 1 : 0.7 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 15, color: C.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.time} · {r.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.sub, marginTop: 1 }}>
                    {formatPrice(r.price, r.currency)}
                    {r.student_id && (packMap[r.student_id] ?? 0) > 0 && (
                      <span style={{ marginLeft: 6, color: C.tealD, fontFamily: C.display, fontWeight: 700 }}>📦 пакет: {packMap[r.student_id]}</span>
                    )}
                  </div>
                </div>
                <Pill on={st.done} label="Провів" onClick={() => setState((s) => ({ ...s, [r.id]: { ...st, done: !st.done } }))} />
                <Pill on={st.done && (st.paid || r.paid)} gold label="₴"
                  onClick={() => st.done && !r.paid && setState((s) => ({ ...s, [r.id]: { ...st, paid: !st.paid } }))} />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: "14px 20px 20px", borderTop: `1px solid ${C.border}`, background: "#fff", display: "flex", gap: 10 }}>
          <button type="button" onClick={() => onOpenChange(false)}
            style={{ height: 52, padding: "0 18px", borderRadius: 14, border: `1px solid ${C.border}`, background: "#fff", color: C.sub, fontFamily: C.display, fontWeight: 700, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>
            Скасувати
          </button>
          <button type="button" onClick={apply} disabled={busy || doneCount === 0}
            style={{ flex: 1, height: 52, borderRadius: 14, border: "none", cursor: busy || doneCount === 0 ? "not-allowed" : "pointer",
              background: doneCount === 0 ? "rgba(43,191,170,.35)" : "linear-gradient(135deg,#2BBFAA,#25a896)",
              color: "#fff", fontFamily: C.display, fontWeight: 700, fontSize: 16,
              boxShadow: doneCount === 0 ? "none" : "0 8px 20px -8px rgba(43,191,170,.6)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            Закрити день{doneCount > 0 ? ` (${doneCount})` : ""}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CloseDayDialog;
