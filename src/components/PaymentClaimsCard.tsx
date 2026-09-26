import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BadgeCheck, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatPrice } from "@/lib/currency";
import { getLocale } from "@/lib/locale";
import { useHaptic } from "@/hooks/useHaptic";
import { burstConfetti } from "@/lib/confetti";

type Claim = {
  id: string;
  student_id: string;
  tutor_id: string;
  amount: number;
  currency: string;
  note: string | null;
  created_at: string;
};

/**
 * «Оля каже, що оплатила 700 ₴ · Підтвердити / Ні» — друга половина важеля 4
 * (аудит шляхів 24.09).
 *
 * Хто це бачить: той, хто гроші ОТРИМУЄ — самостійний репетитор або менеджер
 * школи (RLS віддає лише свої заявки, хабовому репетитору грошей школи не
 * записують). Підтвердження йде через `resolve_payment_claim`, а та кличе
 * канонічний `wallet_topup` — жодної другої грошової логіки в застосунку.
 *
 * Картка НЕ рендериться, коли заявок немає: привид «немає заявок 🎉» на
 * дашборді — це шум, а не інформація.
 */
export function PaymentClaimsCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setClaims([]); return; }
    try {
      const { data, error } = await (supabase.from("payment_claims" as any) as any)
        .select("id, student_id, tutor_id, amount, currency, note, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return; // таблиці ще нема (міграція не застосована) — картки просто немає
      const rows = ((data ?? []) as Claim[]).map((c) => ({ ...c, amount: Number(c.amount ?? 0) }));
      setClaims(rows);
      const ids = [...new Set(rows.map((c) => c.student_id))];
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, first_name, last_name").in("id", ids);
        const map: Record<string, string> = {};
        ((profs ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).forEach((p) => {
          map[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
        });
        setNames(map);
      }
    } catch {
      /* немає таблиці / немає мережі — картка просто не зʼявляється */
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (claim: Claim, confirm: boolean) => {
    setBusyId(claim.id);
    let res: { data?: any; error?: { message: string } | null } = {};
    try {
      res = await (supabase.rpc as any)("resolve_payment_claim", { _id: claim.id, _confirm: confirm });
    } catch (e) {
      res = { error: { message: e instanceof Error ? e.message : String(e) } };
    } finally {
      setBusyId(null);
    }
    if (res.error || !res.data?.ok) {
      toast.error(t("claims.failed"), { description: res.error?.message ?? res.data?.reason });
      return;
    }
    // Святкуємо лише збережене (рішення 15.09): конфеті — після відповіді бази.
    setClaims((prev) => prev.filter((c) => c.id !== claim.id));
    if (confirm) {
      haptic.success();
      burstConfetti();
      toast.success(t("claims.confirmed", { amount: formatPrice(claim.amount, claim.currency) }), {
        description: names[claim.student_id],
      });
    } else {
      haptic.tap();
      toast.info(t("claims.rejected"), { description: names[claim.student_id] });
    }
  };

  if (claims.length === 0) return null;

  return (
    <div className="rounded-[16px] border bg-card p-4" style={{ borderColor: "rgba(43,191,170,.35)" }}>
      <p className="mb-2 text-[14px] font-bold text-foreground">💸 {t("claims.title", { count: claims.length })}</p>
      <div className="space-y-2">
        {claims.map((c) => {
          const at = new Date(c.created_at);
          return (
            <div key={c.id} className="rounded-[12px] p-3" style={{ background: "var(--ds-surface3,#f6f5f1)" }}>
              <p className="text-[15px] font-semibold" style={{ color: "var(--ds-txt,#0f0f1a)" }}>
                {t("claims.says", {
                  name: names[c.student_id] || t("roles.student"),
                  amount: formatPrice(c.amount, c.currency),
                })}
              </p>
              <p className="mt-0.5 text-[14px]" style={{ color: "var(--sub,#62677E)" }}>
                {Number.isNaN(at.getTime()) ? "" : at.toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {c.note ? ` · ${c.note}` : ""}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void resolve(c, true)}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] text-[15px] font-bold"
                  style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", border: "none", cursor: "pointer" }}
                >
                  {busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                  {t("claims.confirm")}
                </button>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void resolve(c, false)}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-[12px] px-4 text-[15px] font-bold"
                  style={{ background: "var(--ds-surface,#fff)", color: "var(--sub,#62677E)", border: "1px solid var(--ds-border,#eceef3)", cursor: "pointer" }}
                >
                  <X className="h-4 w-4" />
                  {t("claims.reject")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("claims.hint")}</p>
    </div>
  );
}
