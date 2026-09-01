import { useEffect, useState } from "react";
import { openExternal } from "@/lib/openExternal";
import { getLocale } from "@/lib/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Check, Clock, Wallet, Copy, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useHaptic } from "@/hooks/useHaptic";
import { SkeletonList } from "@/components/SkeletonCard";
import { formatPrice, currencySymbol } from "@/lib/currency";
import { useTranslation } from "react-i18next";

interface Row {
  id: string;
  subject: string;
  is_cancellation_fee?: boolean;
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
  // useTranslation (not a module-level bound t): the page must re-render live when
  // the student switches language — this was the only student page that stayed stale.
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tap: hapticTap } = useHaptic();

  // Paying is the student's core money task — one tap must put the tutor's payment
  // details in the clipboard instead of forcing a manual re-type from the card above.
  const payInfoFor = (tutorId: string) =>
    tutorPayInfos.find((p) => p.tutor_id === tutorId && p.payment_details);
  const copyDetails = (info: TutorPayInfo) => {
    navigator.clipboard.writeText(info.payment_details ?? "");
    hapticTap();
    toast.success(t("studentPagesExtra.detailsCopied"));
  };
  // №17 (ідеї 01.09): якщо в реквізитах є посилання (банка monobank, LiqPay,
  // будь-який https) — «скопіюй і йди в банк» перетворюється на КНОПКУ оплати.
  // Оплата уроку живій людині — послуга офлайн: Apple 3.1.1 стосується
  // цифрових підписок, але перед релізом у сторі перевіримо окремо.
  const paymentLinkOf = (details: string | null | undefined): string | null => {
    const m = (details ?? "").match(/https?:\/\/\S+/);
    return m ? m[0].replace(/[),.;]+$/, "") : null;
  };
  const openPayLink = (link: string) => {
    hapticTap();
    // BUG-6: сирий window.open у нативному WebView відводить застосунок без
    // кнопки назад — користувач у пастці. Усі зовнішні посилання йдуть через це.
    openExternal(link);
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [tutorPayInfos, setTutorPayInfos] = useState<TutorPayInfo[]>([]);
  const [walletBalances, setWalletBalances] = useState<{ tutor_id: string; lessons_balance: number; amount_balance: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Cancelled lessons are included so a withheld CANCELLATION FEE (marked via
      // is_cancellation_fee) shows up as a payable row — plain cancellations are
      // filtered out below once the details arrive.
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, subject, starts_at, tutor_id, status")
        .eq("student_id", user.id)
        .order("starts_at", { ascending: false });
      const lessonIds0 = ((lessons ?? []) as any[]).map((l) => l.id);
      let detailsRes: any = lessonIds0.length
        ? await supabase
            .from("lesson_details_student" as any)
            .select("lesson_id, student_price, student_payment_status, is_cancellation_fee")
            .in("lesson_id", lessonIds0)
        : { data: [] as any[], error: null };
      if (detailsRes.error)
        // pre-apply fallback (migration 20260721000000 adds the fee column)
        detailsRes = await supabase
          .from("lesson_details_student" as any)
          .select("lesson_id, student_price, student_payment_status")
          .in("lesson_id", lessonIds0);
      const detailsRows = detailsRes.data;
      const detailsMap: Record<string, any> = {};
      (detailsRows ?? []).forEach((d: any) => { detailsMap[d.lesson_id] = d; });
      const individual = ((lessons ?? []) as any[])
        .filter((l) =>
          l.status !== "cancelled" ||
          (detailsMap[l.id]?.is_cancellation_fee === true && Number(detailsMap[l.id]?.student_price ?? 0) > 0))
        .map((l) => ({
          id: l.id,
          subject: l.subject,
          starts_at: l.starts_at,
          tutor_id: l.tutor_id,
          student_price: Number(detailsMap[l.id]?.student_price ?? 0),
          student_payment_status: detailsMap[l.id]?.student_payment_status ?? "unpaid",
          is_cancellation_fee: detailsMap[l.id]?.is_cancellation_fee === true,
        }));
      // GROUP lessons: the student's price/payment lives on lesson_participants
      // (the lesson row has student_id=NULL). Pull them in with their own currency.
      const { data: gParts } = await (supabase.from("lesson_participants_visible" as any) as any)
        .select("lesson_id, student_price, currency, student_payment_status, subject, starts_at, tutor_id, status")
        .eq("student_id", user.id)
        .neq("status", "cancelled");
      const groupRows = ((gParts ?? []) as any[])
        .map((p) => ({
          id: p.lesson_id,
          subject: p.subject,
          starts_at: p.starts_at,
          tutor_id: p.tutor_id,
          student_price: Number(p.student_price ?? 0),
          student_payment_status: (p.student_payment_status ?? "unpaid") as string,
          currency: p.currency ?? "UAH",
        }));
      const list = [...individual, ...groupRows];
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
          // group rows carry their own currency (from lesson_participants); individual
          // rows take the per-tutor student_rates currency.
          currency: (l as any).currency ?? payMap[l.tutor_id]?.currency ?? "UAH",
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
    new Date(iso).toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const tutorsWithDetails = tutorPayInfos.filter(
    (t) => t.payment_details && t.payment_details.trim(),
  );

  return (
    <>
      <div className="space-y-4">
        <h1 className="hidden text-2xl font-bold text-foreground lg:block">{t("studentPages.paymentsTitle")}</h1>

        {walletBalances.length > 0 && (
          <div style={{ borderRadius: 18, padding: "16px 18px", background: "linear-gradient(135deg,#0f0f1a,#1a1f3a)", color: "#fff", boxShadow: "0 14px 34px -18px rgba(15,15,26,.7)" }}>
            <div style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".09em", color: "rgba(255,255,255,.55)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700 }}>
              {t("studentPagesExtra.prepaidLabel")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {walletBalances.map((b) => {
                const info = tutorPayInfos.find((ti) => ti.tutor_id === b.tutor_id);
                return (
                  <div key={b.tutor_id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 15, color: "rgba(255,255,255,.75)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {info?.tutor_name ?? t("studentPages.tutorFallback")}
                    </span>
                    <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 17, color: "#2BBFAA", flexShrink: 0 }}>
                      {b.lessons_balance > 0 && t("studentPagesExtra.lessonsBalance", { count: b.lessons_balance })}
                      {b.lessons_balance > 0 && b.amount_balance > 0 && " · "}
                      {b.amount_balance > 0 && formatPrice(b.amount_balance, info?.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,.5)", marginTop: 8 }}>{t("studentPagesExtra.autoDeductHint")}</p>
          </div>
        )}

        {currencyEntries.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <div style={{ borderRadius: 16, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: "14px 15px" }}>
              <p style={{ fontSize: 14, color: "var(--sub,#666b82)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPages.toPay")}</p>
              <p style={{ marginTop: 4, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 24, color: "#b4740b" }}>0</p>
            </div>
            <div style={{ borderRadius: 16, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: "14px 15px" }}>
              <p style={{ fontSize: 14, color: "var(--sub,#666b82)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPages.paid")}</p>
              <p style={{ marginTop: 4, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 24, color: "#16a34a" }}>0</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div style={{ borderRadius: 16, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: "14px 15px" }}>
              <p style={{ fontSize: 14, color: "var(--sub,#666b82)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPages.toPay")}</p>
              <div className="mt-1 space-y-0.5">
                {currencyEntries.map(([c, v]) => (
                  <p key={c} style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 22, color: "#b4740b" }}>
                    {formatPrice(v.unpaid, c, { decimals: 0 })}
                  </p>
                ))}
              </div>
            </div>
            <div style={{ borderRadius: 16, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: "14px 15px" }}>
              <p style={{ fontSize: 14, color: "var(--sub,#666b82)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{t("studentPages.paid")}</p>
              <div className="mt-1 space-y-0.5">
                {currencyEntries.map(([c, v]) => (
                  <p key={c} style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 22, color: "#16a34a" }}>
                    {formatPrice(v.paid, c, { decimals: 0 })}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {tutorsWithDetails.length > 0 && (
          <div style={{ borderRadius: 18, padding: 16, background: "linear-gradient(135deg,#FFF7E6,#FFEFD0)", border: "1px solid rgba(245,181,68,.4)" }}>
            <div className="mb-2 flex items-center gap-2">
              <Wallet className="h-4 w-4" style={{ color: "#9a6a12" }} />
              <h2 style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15, color: "#7a5a14" }}>{t("studentPagesExtra.howToPay")}</h2>
            </div>
            <ul className="space-y-2">
              {tutorsWithDetails.map((tp) => (
                <li key={tp.tutor_id} style={{ borderRadius: 12, background: "rgba(255,255,255,.6)", padding: "11px 13px" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p style={{ fontSize: 14, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, color: "#9a6a12" }}>
                        {tp.tutor_name} · {currencySymbol(tp.currency)} {tp.currency}
                      </p>
                      <p style={{ marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, color: "var(--ds-txt,#0f0f1a)" }}>
                        {tp.payment_details}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyDetails(tp)}
                      aria-label={t("studentPagesExtra.copyDetails")}
                      title={t("studentPagesExtra.copyDetails")}
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] transition-opacity hover:opacity-70"
                      style={{ background: "rgba(154,106,18,.12)", color: "#9a6a12", border: "none", cursor: "pointer" }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {/* №17: реквізити містять посилання → справжня кнопка оплати */}
                  {paymentLinkOf(tp.payment_details) && (
                    <button
                      type="button"
                      onClick={() => openPayLink(paymentLinkOf(tp.payment_details)!)}
                      className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] transition-opacity active:opacity-90"
                      style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15, boxShadow: "0 6px 16px -8px rgba(43,191,170,.6)" }}
                    >
                      💳 {t("studentPagesExtra.payNow")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <SkeletonList count={3} />
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 16px", borderRadius: 18, border: "1px dashed var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", fontSize: 14, color: "var(--sub,#666b82)" }}>{t("studentPagesExtra.noLessonsCard")}</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r) => {
              const paid = r.student_payment_status === "paid";
              return (
                <li key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderRadius: 16, border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)", padding: "11px 13px" }}>
                    <div className="min-w-0">
                      <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: "var(--ds-txt,#0f0f1a)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.subject}
                        {r.is_cancellation_fee && <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 700, color: "#b4740b", background: "rgba(245,158,11,.14)", borderRadius: 7, padding: "1px 7px" }}>{t("studentPagesExtra.cancellationFee")}</span>}
                      </p>
                      <p style={{ fontSize: 14, color: "var(--sub,#666b82)", marginTop: 1 }}>{fmt(r.starts_at)} · {r.tutor_name}</p>
                    </div>
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15, color: "var(--ds-txt,#0f0f1a)" }}>{formatPrice(r.student_price, r.currency, { decimals: 0 })}</span>
                      <span className="flex items-center gap-1" style={{ height: 24, padding: "0 9px", borderRadius: 999, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, background: paid ? "rgba(34,197,94,.16)" : "rgba(245,158,11,.16)", color: paid ? "#16a34a" : "#b4740b" }}>
                        {paid ? <Check className="h-3 w-3" aria-hidden="true" /> : <Clock className="h-3 w-3" aria-hidden="true" />}
                        {paid ? t("studentPagesExtra.paidStatus") : t("studentPagesExtra.awaitingStatus")}
                      </span>
                      {/* №17: посилання в реквізитах → кнопка «Оплатити» просто в рядку боргу */}
                      {!paid && paymentLinkOf(payInfoFor(r.tutor_id)?.payment_details) && (
                        <button
                          type="button"
                          onClick={() => openPayLink(paymentLinkOf(payInfoFor(r.tutor_id)?.payment_details)!)}
                          className="flex h-11 flex-shrink-0 items-center justify-center gap-1 rounded-[10px] px-3 transition-opacity active:opacity-90"
                          style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 14 }}
                        >
                          💳 {t("studentPagesExtra.payNow")}
                        </button>
                      )}
                      {!paid && payInfoFor(r.tutor_id) && (
                        <button
                          type="button"
                          onClick={() => copyDetails(payInfoFor(r.tutor_id)!)}
                          aria-label={t("studentPagesExtra.copyDetails")}
                          title={t("studentPagesExtra.copyDetails")}
                          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] transition-opacity hover:opacity-70"
                          style={{ background: "rgba(245,158,11,.12)", color: "#b4740b", border: "none", cursor: "pointer" }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!paid && !payInfoFor(r.tutor_id) && (
                        // Group-only pairs have no stored payment details (student_rates
                        // row doesn't exist) — offer the chat instead of nothing.
                        <Link
                          to={`/chats?with=${r.tutor_id}`}
                          aria-label={t("studentPagesExtra.askInChat")}
                          title={t("studentPagesExtra.askInChat")}
                          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] transition-opacity hover:opacity-70"
                          style={{ background: "rgba(43,191,170,.12)", color: "#0F6E56" }}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
