import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, Sparkles } from "lucide-react";

interface PairBalance {
  tutor_id: string;
  tutor_name: string;
  lessons_balance: number;
  amount_balance: number;
}

/**
 * Інформативна картка балансу для учня — без дій.
 * Показує лише пари, де є залишок.
 */
export function StudentWalletCard({ studentId }: { studentId: string }) {
  const [pairs, setPairs] = useState<PairBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: balances } = await supabase
        .from("student_wallet_balances" as any)
        .select("*")
        .eq("student_id", studentId);

      const rows = ((balances as any[]) ?? []).filter(
        (b) => b.lessons_balance > 0 || Number(b.amount_balance) > 0,
      );
      if (rows.length === 0) {
        if (!cancelled) {
          setPairs([]);
          setLoading(false);
        }
        return;
      }

      const tutorIds = rows.map((r) => r.tutor_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", tutorIds);
      const nameMap = new Map(
        (profiles ?? []).map((p: any) => [
          p.id,
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Репетитор",
        ]),
      );

      if (!cancelled) {
        setPairs(
          rows.map((r) => ({
            tutor_id: r.tutor_id,
            tutor_name: nameMap.get(r.tutor_id) ?? "Репетитор",
            lessons_balance: r.lessons_balance,
            amount_balance: Number(r.amount_balance),
          })),
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading || pairs.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Wallet className="h-4 w-4 text-primary" />
          Мій баланс
          <Sparkles className="h-3.5 w-3.5 text-primary/60" />
        </div>
        <ul className="space-y-2">
          {pairs.map((p) => (
            <li
              key={p.tutor_id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-foreground/80 truncate">{p.tutor_name}</span>
              <span className="shrink-0 tabular-nums font-medium text-primary">
                {p.lessons_balance > 0 && `🎟 ${p.lessons_balance} ур.`}
                {p.lessons_balance > 0 && p.amount_balance > 0 && " · "}
                {p.amount_balance > 0 && `${p.amount_balance.toFixed(0)} ₴`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Уроки списуються з балансу автоматично, як тільки репетитор їх створить.
        </p>
      </CardContent>
    </Card>
  );
}
