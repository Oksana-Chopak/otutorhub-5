import { useEffect, useState } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Loader2, Check, Clock } from "lucide-react";

interface Row {
  id: string;
  subject: string;
  starts_at: string;
  student_price: number;
  student_payment_status: string;
  tutor_id: string;
  tutor_name?: string;
}

export default function StudentPaymentsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: lessons }, { data: profiles }] = await Promise.all([
        supabase
          .from("lessons")
          .select("id, subject, starts_at, student_price, student_payment_status, tutor_id, status")
          .eq("student_id", user.id)
          .neq("status", "cancelled")
          .order("starts_at", { ascending: false }),
        supabase.from("profiles").select("id, first_name, last_name"),
      ]);
      const map: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => {
        map[p.id] = `${p.first_name} ${p.last_name}`.trim();
      });
      setRows(((lessons ?? []) as Row[]).map((l) => ({ ...l, tutor_name: map[l.tutor_id] })));
      setLoading(false);
    })();
  }, [user?.id]);

  const totalUnpaid = rows
    .filter((r) => r.student_payment_status === "unpaid")
    .reduce((s, r) => s + Number(r.student_price), 0);
  const totalPaid = rows
    .filter((r) => r.student_payment_status === "paid")
    .reduce((s, r) => s + Number(r.student_price), 0);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">Оплати</h1>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">До оплати</p>
            <p className="mt-1 text-xl font-bold text-warning">{totalUnpaid.toFixed(0)} грн</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Оплачено</p>
            <p className="mt-1 text-xl font-bold text-success">{totalPaid.toFixed(0)} грн</p>
          </Card>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Уроків ще немає</Card>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const paid = r.student_payment_status === "paid";
              return (
                <li key={r.id}>
                  <Card className="flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{r.subject}</p>
                      <p className="text-xs text-muted-foreground">{fmt(r.starts_at)} · {r.tutor_name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-foreground">{Number(r.student_price).toFixed(0)} грн</span>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${paid ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                        {paid ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {paid ? "Оплачено" : "Очікує"}
                      </span>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </StudentLayout>
  );
}
