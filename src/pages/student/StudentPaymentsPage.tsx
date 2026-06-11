import { useEffect, useState } from "react";
import { StudentLayout } from "@/components/student/StudentLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Loader2, Check, Clock, Wallet } from "lucide-react";
import { formatPrice, currencySymbol } from "@/lib/currency";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

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
  const [walletBalances, setWalletBalances] = useState<{ tutor_id: string; lessons_balance: number; amount_balance: number }[]>([]);
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
      // 📦 Передплачені пакети: баланс гаманця по кожному репетитору
      try {
        const { data: bal } = await (supabase as any)
          .from("student_wallet_balances")
          .select("tutor_id, lessons_balance, amount_balance")
          .eq("student_id", user.id);
        setWalletBalances(
          ((bal ?? []) as any[])
            .map((b) => ({ tutor_id: b.tutor_id as string, lessons_balance: Number(b.lessons_balance ?? 0), amount_balance: Number(b.amount_balance ?? 0) }))
            .filter((b) => b.lessons_balance > 0 || b.amount_balance > 0)
        );
      } catch { /* view may be absent */ }
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

        {walletBalances.length > 0 && (
          <div style={{ borderRadius: 18, padding: "16px 18px", background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", color: "#fff", boxShadow: "0 14px 34px -18px rgba(15,15,26,.7)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700 }}>
              📦 Передплачено
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {walletBalances.map((b) => {
                const info = tutorPayInfos.find((ti) => ti.tutor_id === b.tutor_id);
                return (
                  <div key={b.tutor_id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 13.5, color: "rgba(255,255,255,.75)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {info?.tutor_name ?? "Репетитор"}
                    </span>
                    <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, color: "#2BBFAA", flexShrink: 0 }}>
                      {b.lessons_balance > 0 && `${b.lessons_balance} ур.`}
                      {b.lessons_balance > 0 && b.amount_balance > 0 && " · "}
                      {b.amount_balance > 0 && formatPrice(b.amount_balance, info?.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,.5)", marginTop: 8 }}>Списується автоматично після проведених уроків</p>
          </div>
        )}

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
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${paid ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
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
