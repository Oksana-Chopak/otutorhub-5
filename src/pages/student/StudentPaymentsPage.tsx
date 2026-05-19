import { useEffect, useState } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Loader2, Check, Clock, Wallet } from "lucide-react";
import { formatPrice, currencySymbol } from "@/lib/currency";

interface Row {
  id: string;
  subject: string;
  starts_at: string;
  student_price: number;
  student_payment_status: string;
  tutor_id: string;
  tutor_name?: string;
  currency: string;
}

interface TutorPayInfo {
  tutor_id: string;
  tutor_name: string;
  currency: string;
  payment_details: string | null;
}

export default function StudentPaymentsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [tutorPayInfos, setTutorPayInfos] = useState<TutorPayInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, subject, starts_at, tutor_id, status, lesson_details(student_price, student_payment_status)")
        .eq("student_id", user.id)
        .neq("status", "cancelled")
        .order("starts_at", { ascending: false });
      const list = ((lessons ?? []) as any[]).map((l) => ({
        id: l.id,
        subject: l.subject,
        starts_at: l.starts_at,
        tutor_id: l.tutor_id,
        student_price: Number(l.lesson_details?.student_price ?? 0),
        student_payment_status: l.lesson_details?.student_payment_status ?? "unpaid",
      }));
      const tutorIds = Array.from(new Set(list.map((l) => l.tutor_id)));
      const [{ data: profiles }, { data: rates }] = await Promise.all([
        tutorIds.length
          ? supabase.from("profiles").select("id, first_name, last_name").in("id", tutorIds)
          : Promise.resolve({ data: [] as any[] }),
        tutorIds.length
          ? supabase
              .from("student_rates")
              .select("tutor_id, currency, payment_details")
              .eq("student_id", user.id)
              .in("tutor_id", tutorIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const nameMap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => {
        nameMap[p.id] = `${p.first_name} ${p.last_name}`.trim();
      });
      const payMap: Record<string, { currency: string; payment_details: string | null }> = {};
      (rates ?? []).forEach((r: any) => {
        payMap[r.tutor_id] = {
          currency: r.currency ?? "UAH",
          payment_details: r.payment_details ?? null,
        };
      });
      setRows(
        list.map((l) => ({
          ...l,
          tutor_name: nameMap[l.tutor_id],
          currency: payMap[l.tutor_id]?.currency ?? "UAH",
        }))
      );
      setTutorPayInfos(
        tutorIds.map((id) => ({
          tutor_id: id,
          tutor_name: nameMap[id] ?? t("studentPages.tutorFallback"),
          currency: payMap[id]?.currency ?? "UAH",
          payment_details: payMap[id]?.payment_details ?? null,
        }))
      );
      setLoading(false);
    })();
  }, [user?.id]);

  // Group totals by currency to avoid mixing currencies in summary cards.
  const totalsByCurrency = rows.reduce<Record<string, { unpaid: number; paid: number }>>(
    (acc, r) => {
      const c = r.currency ?? "UAH";
      acc[c] ??= { unpaid: 0, paid: 0 };
      if (r.student_payment_status === "paid") acc[c].paid += Number(r.student_price);
      else acc[c].unpaid += Number(r.student_price);
      return acc;
    },
    {},
  );
  const currencyEntries = Object.entries(totalsByCurrency);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const tutorsWithDetails = tutorPayInfos.filter(
    (t) => t.payment_details && t.payment_details.trim(),
  );

  return (
    <StudentLayout>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">{t("studentPages.paymentsTitle")}</h1>

        {currencyEntries.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("studentPages.toPay")}</p>
              <p className="mt-1 text-xl font-bold text-warning">0</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("studentPages.paid")}</p>
              <p className="mt-1 text-xl font-bold text-success">0</p>
            </Card>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("studentPages.toPay")}</p>
              <div className="mt-1 space-y-0.5">
                {currencyEntries.map(([c, v]) => (
                  <p key={c} className="text-xl font-bold text-warning">
                    {formatPrice(v.unpaid, c, { decimals: 0 })}
                  </p>
                ))}
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("studentPages.paid")}</p>
              <div className="mt-1 space-y-0.5">
                {currencyEntries.map(([c, v]) => (
                  <p key={c} className="text-xl font-bold text-success">
                    {formatPrice(v.paid, c, { decimals: 0 })}
                  </p>
                ))}
              </div>
            </Card>
          </div>
        )}

        {tutorsWithDetails.length > 0 && (
          <Card className="border-primary/30 bg-primary/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{t("studentPagesExtra.howToPay")}</h2>
            </div>
            <ul className="space-y-3">
              {tutorsWithDetails.map((t) => (
                <li key={t.tutor_id} className="rounded-md bg-card/60 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t.tutor_name} · {currencySymbol(t.currency)} {t.currency}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                    {t.payment_details}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">{t("studentPagesExtra.noLessonsCard")}</Card>
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
                      <span className="font-semibold text-foreground">{formatPrice(r.student_price, r.currency, { decimals: 0 })}</span>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${paid ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                        {paid ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {paid ? t("studentPagesExtra.paidStatus") : t("studentPagesExtra.awaitingStatus")}
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
