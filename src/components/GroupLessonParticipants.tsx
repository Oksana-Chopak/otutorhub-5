import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useHaptic } from "@/hooks/useHaptic";
import { currencySymbol } from "@/lib/currency";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";

interface Participant {
  id: string;
  student_id: string;
  student_price: number | null;
  currency: string;
  student_payment_status: "paid" | "unpaid";
  name: string;
}

/**
 * Per-participant roster + payment marking for a GROUP lesson. A group lesson has
 * lessons.student_id = NULL; each student's price + payment lives on a
 * lesson_participants row. canEdit (manager or owning tutor) enables the pay toggle.
 */
export function GroupLessonParticipants({
  lessonId,
  canEdit,
  onUpdated,
}: {
  lessonId: string;
  canEdit: boolean;
  onUpdated?: () => void;
}) {
  const { t } = useTranslation();
  // MON-2: group student prices/payments are hub money. A HUB tutor may see the
  // roster (attendance) but not the per-student price or the pay toggle — only
  // hub-scoped managers and independent owner-tutors handle group money (the
  // server enforces this via set_group_participant_payment + column locks).
  const { roles } = useAuth();
  const { isIndependent, loading: wsLoading } = useWorkspaceSettings();
  const canSeeMoney = roles.includes("manager") || (!wsLoading && isIndependent);
  const haptic = useHaptic();
  const [rows, setRows] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    // Masked view: hub tutors keep the roster but money reads NULL (server-side
    // enforcement of what the UI below also hides).
    const { data: parts } = await (supabase.from("lesson_participants_visible" as any) as any)
      .select("id, student_id, student_price, currency, student_payment_status")
      .eq("lesson_id", lessonId);
    const ids = Array.from(new Set((parts ?? []).map((p: any) => p.student_id))) as string[];
    const nameMap: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      (profs ?? []).forEach((p: any) => {
        nameMap[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || t("shared.student");
      });
    }
    setRows(
      (parts ?? []).map((p: any) => ({
        id: p.id,
        student_id: p.student_id,
        student_price: p.student_price,
        currency: p.currency ?? "UAH",
        student_payment_status: (p.student_payment_status ?? "unpaid") as "paid" | "unpaid",
        name: nameMap[p.student_id] ?? t("shared.student"),
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const togglePaid = async (p: Participant) => {
    const next = p.student_payment_status === "paid" ? "unpaid" : "paid";
    setBusyId(p.id);
    // optimistic
    setRows((prev) => prev.map((r) => (r.id === p.id ? { ...r, student_payment_status: next } : r)));
    // Money writes go through the gated RPC (hub-scoped manager OR independent
    // owner) — direct column UPDATE is revoked since 20260719000000.
    const { error } = await (supabase.rpc as any)("set_group_participant_payment", {
      _participant_ids: [p.id],
      _status: next,
    });
    setBusyId(null);
    if (error) {
      haptic.error();
      setRows((prev) => prev.map((r) => (r.id === p.id ? { ...r, student_payment_status: p.student_payment_status } : r)));
      toast.error(t("groupPayments.markFailed"));
      return;
    }
    if (next === "paid") {
      haptic.success();
      toast.success(t("groupPayments.markedPaid", { name: p.name }));
    }
    onUpdated?.();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p style={{ fontSize: 14, color: "var(--sub,#6b7088)" }}>{t("groupPayments.noParticipants")}</p>;
  }

  const paidCount = rows.filter((r) => r.student_payment_status === "paid").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p style={{ fontFamily: "Inter, system-ui", fontWeight: 700, fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub,#6b7088)" }}>
          {t("groupPayments.title")}
        </p>
        {canSeeMoney && (
          <span style={{ fontSize: 14, fontWeight: 700, color: paidCount === rows.length ? "#16a34a" : "#9a6a12" }}>
            {t("groupPayments.paidOfTotal", { paid: paidCount, total: rows.length })}
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {rows.map((p) => {
          const paid = p.student_payment_status === "paid";
          return (
            <li key={p.id} className="flex items-center gap-2 rounded-[13px] border border-border bg-white px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p style={{ fontFamily: "Inter, system-ui", fontWeight: 700, fontSize: 15, color: "#0f0f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</p>
                {canSeeMoney && (
                  <p style={{ fontSize: 14, color: "var(--sub,#6b7088)" }}>
                    {p.student_price != null ? `${p.student_price} ${currencySymbol(p.currency)}` : t("groupPayments.noPrice")}
                  </p>
                )}
              </div>
              {canSeeMoney && (
              <button
                type="button"
                disabled={!canEdit || busyId === p.id}
                onClick={() => togglePaid(p)}
                style={{
                  flexShrink: 0, height: 38, padding: "0 14px", borderRadius: 11, cursor: canEdit ? "pointer" : "default",
                  display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "Inter, system-ui", fontWeight: 700, fontSize: 15,
                  border: "none",
                  background: paid ? "rgba(34,197,94,.16)" : "rgba(245,181,68,.16)",
                  color: paid ? "#15803d" : "#9a6a12",
                  opacity: canEdit ? 1 : 0.8,
                }}
              >
                {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : paid ? <Check size={15} strokeWidth={2.6} /> : null}
                {paid ? t("groupPayments.paid") : t("groupPayments.markPaid")}
              </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
