import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, Wallet, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface UnpaidRow {
  id: string;
  starts_at: string;
  subject: string;
  student_id: string;
  student_price: number;
  student_name: string;
}

const MAX_VISIBLE = 5;

/**
 * Dashboard card for tutors: shows completed lessons that are still unpaid by
 * the student, with a one-click "Отримано" action. Removes the need to dig
 * into Finances/Schedule for the most common Monday-morning task.
 */
export function PendingPaymentsCard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UnpaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: lessons } = await supabase
      .from("lessons")
      .select("id, starts_at, subject, student_id, student_price")
      .eq("tutor_id", user.id)
      .eq("status", "completed")
      .eq("student_payment_status", "unpaid")
      .gt("student_price", 0)
      .order("starts_at", { ascending: false })
      .limit(50);

    const ids = Array.from(new Set((lessons ?? []).map((l: any) => l.student_id)));
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      (profs ?? []).forEach((p: any) => {
        names[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень";
      });
    }
    setRows(
      (lessons ?? []).map((l: any) => ({
        id: l.id,
        starts_at: l.starts_at,
        subject: l.subject,
        student_id: l.student_id,
        student_price: Number(l.student_price ?? 0),
        student_name: names[l.student_id] ?? "Учень",
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const markPaid = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase
      .from("lessons")
      .update({
        student_payment_status: "paid",
        student_paid_at: new Date().toISOString(),
      })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Не вдалося оновити");
      return;
    }
    setRows((r) => r.filter((x) => x.id !== id));
    toast.success("Позначено як оплачено");
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  const total = rows.reduce((s, r) => s + r.student_price, 0);
  const visible = showAll ? rows : rows.slice(0, MAX_VISIBLE);

  return (
    <Card className="border-warning/40 bg-gradient-to-br from-warning/5 to-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 font-display text-base">
          <Wallet className="h-4 w-4 text-warning" />
          Очікують оплати
          <Badge variant="outline" className="ml-1 text-[10px]">
            {rows.length} · {total} ₴
          </Badge>
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
          <Link to="/finances">
            Усі
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {visible.map((r) => {
            const d = new Date(r.starts_at);
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {r.student_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.subject} · {d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" })}
                    {" · "}
                    <span className="font-medium text-foreground">{r.student_price} ₴</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-8 shrink-0 gap-1"
                  onClick={() => markPaid(r.id)}
                  disabled={busyId === r.id}
                >
                  {busyId === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Отримано
                </Button>
              </li>
            );
          })}
        </ul>
        {rows.length > MAX_VISIBLE && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-xs"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Згорнути" : `Показати ще ${rows.length - MAX_VISIBLE}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
