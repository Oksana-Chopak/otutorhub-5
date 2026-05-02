import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface WalletBalance {
  lessons_balance: number;
  amount_balance: number;
  last_transaction_at: string | null;
}

export interface WalletTransaction {
  id: string;
  tutor_id: string;
  student_id: string;
  kind: "topup" | "lesson_charge" | "refund" | "adjustment";
  lessons_delta: number;
  amount_delta: number;
  lesson_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export function useStudentWallet(tutorId: string | null, studentId: string | null) {
  const [balance, setBalance] = useState<WalletBalance>({
    lessons_balance: 0,
    amount_balance: 0,
    last_transaction_at: null,
  });
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!tutorId || !studentId) return;
    setLoading(true);
    const [{ data: tx }, { data: bal }] = await Promise.all([
      supabase
        .from("student_wallet_transactions" as any)
        .select("*")
        .eq("tutor_id", tutorId)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false }),
      supabase
        .from("student_wallet_balances" as any)
        .select("*")
        .eq("tutor_id", tutorId)
        .eq("student_id", studentId)
        .maybeSingle(),
    ]);
    setTransactions(((tx as any) ?? []) as WalletTransaction[]);
    setBalance({
      lessons_balance: (bal as any)?.lessons_balance ?? 0,
      amount_balance: Number((bal as any)?.amount_balance ?? 0),
      last_transaction_at: (bal as any)?.last_transaction_at ?? null,
    });
    setLoading(false);
  }, [tutorId, studentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balance, transactions, loading, refresh };
}
