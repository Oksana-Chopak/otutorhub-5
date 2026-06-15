import { useState, useEffect } from "react";
import { getLocale } from "@/lib/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Plus, History, Loader2, ArrowDownLeft, ArrowUpRight, Undo2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useStudentWallet } from "@/hooks/useStudentWallet";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface WalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tutorId: string;
  studentId: string;
  studentName?: string;
  tutorName?: string;
  /** дозволяє поповнення (manager або independent tutor свого учня) */
  canTopUp: boolean;
  /** ставка за урок (для зручного перерахунку) */
  ratePerLesson?: number;
  /** дозволяє менеджеру видаляти/сторнувати транзакції */
  canDelete?: boolean;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(getLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const KIND_LABEL: Record<string, string> = {
  topup: t("walletDialog.topup"),
  lesson_charge: t("walletDialog.lessonCharge"),
  refund: t("walletDialog.refund"),
  adjustment: t("walletDialog.adjustment"),
};

export function WalletDialog({
  open,
  onOpenChange,
  tutorId,
  studentId,
  studentName,
  tutorName,
  canTopUp,
  ratePerLesson,
  canDelete = false,
}: WalletDialogProps) {
  const { balance, transactions, loading, refresh } = useStudentWallet(
    open ? tutorId : null,
    open ? studentId : null,
  );

  const [mode, setMode] = useState<"lessons" | "amount">("lessons");
  const [lessonsCount, setLessonsCount] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (txId: string, hard: boolean) => {
    const label = hard ? t("walletDialog.confirmDeleteHard") : t("walletDialog.confirmDeleteSoft");
    if (!window.confirm(t("walletDialogExtra.confirmPrompt", { action: label }))) return;
    setDeletingId(txId);
    const { error } = await supabase.rpc("wallet_delete_transaction" as any, {
      _tx_id: txId,
      _hard: hard,
    });
    setDeletingId(null);
    if (error) {
      toast.error(t("walletDialogExtra.deleteFailed"), { description: error.message });
      return;
    }
    toast.success(hard ? t("walletDialogExtra.deleted") : t("walletDialogExtra.reversed"));
    refresh();
  };

  const reset = () => {
    setLessonsCount("");
    setAmount("");
    setNote("");
  };

  const handleTopUp = async () => {
    let lessonsDelta = 0;
    let amountDelta = 0;

    if (mode === "lessons") {
      const n = parseInt(lessonsCount, 10);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error(t("walletDialogExtra.lessonsRequired"));
        return;
      }
      lessonsDelta = n;
      if (ratePerLesson && ratePerLesson > 0) {
        // не списуємо суму — рахуємо її в історії як 0; гаманець-уроки списуються по 1
      }
    } else {
      const a = parseFloat(amount.replace(",", "."));
      if (!Number.isFinite(a) || a <= 0) {
        toast.error(t("walletDialogExtra.amountRequired"));
        return;
      }
      amountDelta = a;
    }

    setBusy(true);
    const { error } = await supabase.rpc("wallet_topup" as any, {
      _tutor_id: tutorId,
      _student_id: studentId,
      _lessons_delta: lessonsDelta,
      _amount_delta: amountDelta,
      _note: note || null,
    });
    setBusy(false);
    if (error) {
      toast.error(t("walletDialogExtra.topupFailed"), { description: error.message });
      return;
    }
    toast.success(t("walletDialogExtra.topupSuccess"));
    reset();
    refresh();
  };

  // ── Variant В: Unified tabs state ────────────────────────────────────────────
  const [tab, setTab] = useState<"mark" | "topup" | "history">("mark");
  const [unpaidLessons, setUnpaidLessons] = useState<Array<{
    id: string; starts_at: string; subject: string; student_price: number; currency: string;
  }>>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loadingUnpaid, setLoadingUnpaid] = useState(false);
  const [marking, setMarking] = useState(false);

  // Fetch unpaid lessons when tab = mark
  useEffect(() => {
    if (!open || !tutorId || !studentId) return;
    setLoadingUnpaid(true);
    (supabase as any)
      .from("lesson_details")
      .select("lesson_id, starts_at, subject, student_price, currency")
      .eq("tutor_id", tutorId)
      .eq("student_id", studentId)
      .eq("student_payment_status", "unpaid")
      .order("starts_at", { ascending: false })
      .then(({ data }: { data: any[] | null }) => {
        const rows = (data ?? []).map((l: any) => ({ ...l, id: l.lesson_id }));
        setUnpaidLessons(rows);
        setCheckedIds(new Set(rows.map((l: any) => l.id)));
        setLoadingUnpaid(false);
      });
  }, [open, tutorId, studentId]);

  const handleMarkPaid = async () => {
    if (checkedIds.size === 0) return;
    setMarking(true);
    const upsertRows = Array.from(checkedIds).map(lid => ({
      lesson_id: lid,
      student_payment_status: "paid",
    }));
    const { error } = await (supabase as any)
      .from("lesson_details")
      .upsert(upsertRows, { onConflict: "lesson_id" });
    setMarking(false);
    if (error) { toast.error(t("walletDialog.markFailed")); return; }
    toast.success(t("walletDialog.markedPaid", { count: checkedIds.size }));
    setUnpaidLessons(prev => prev.filter(l => !checkedIds.has(l.id)));
    setCheckedIds(new Set());
    refresh();
  };

  const toggleCheck = (id: string) => {
    setCheckedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const checkedTotal = unpaidLessons
    .filter(l => checkedIds.has(l.id))
    .reduce((s, l) => s + (l.student_price ?? 0), 0);

  // ── Design tokens ─────────────────────────────────────────────────────────────
  const F = {
    teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9",
    border: "#eceef3", bg: "#F5F4F0", surface: "#fff",
    txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8",
    display: "Inter, system-ui, sans-serif",
    body: "'Plus Jakarta Sans', system-ui, sans-serif",
  };

  const GRADS = [
    "linear-gradient(135deg,#2BBFAA,#1d8f7e)",
    "linear-gradient(135deg,#6366F1,#4f46e5)",
    "linear-gradient(135deg,#F59E0B,#d97706)",
    "linear-gradient(135deg,#EF4444,#dc2626)",
    "linear-gradient(135deg,#EC4899,#db2777)",
    "linear-gradient(135deg,#8B5CF6,#7c3aed)",
  ];
  const ava = (name: string) => GRADS[((name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0)) % GRADS.length];
  const ini = (name: string) => name.trim().split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  const fmt = (d: string) => new Date(d).toLocaleDateString(getLocale(), { weekday: "short", day: "numeric", month: "short" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[88vh] overflow-hidden flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-0 flex-shrink-0">
          <div style={{ width: 38, height: 5, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px 10px", flexShrink: 0 }}>
          <div>
            <p style={{ fontFamily: F.display, fontWeight: 800, fontSize: 18, color: F.txt, lineHeight: 1.2 }}>
              {t("walletDialog.paymentHeader", { name: studentName ?? t("walletDialog.studentFallback") })}
            </p>
            <div style={{ display: "flex", gap: 14, marginTop: 5 }}>
              {loading ? (
                <span style={{ fontSize: 13, color: F.muted, fontFamily: F.body }}>…</span>
              ) : (
                <>
                  <span style={{ fontSize: 15, fontFamily: F.display, color: F.txt }}>
                    <strong>{balance?.lessons_balance ?? 0}</strong>
                    <span style={{ fontSize: 13, color: F.sub, marginLeft: 4, fontFamily: F.body }}>{t("walletDialog.lessonsLabel")}</span>
                  </span>
                  <span style={{ fontSize: 15, fontFamily: F.display, color: F.txt }}>
                    <strong style={{ color: (balance?.amount_balance ?? 0) > 0 ? F.tealD : F.txt }}>
                      {balance?.amount_balance ?? 0}₴
                    </strong>
                    <span style={{ fontSize: 13, color: F.sub, marginLeft: 4, fontFamily: F.body }}>{t("walletDialog.balanceLabel")}</span>
                  </span>
                </>
              )}
            </div>
          </div>
          <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0,
            background: ava(studentName ?? "?"), display: "flex", alignItems: "center",
            justifyContent: "center", fontFamily: F.display, fontWeight: 800, fontSize: 16, color: "#fff" }}>
            {ini(studentName ?? "?")}
          </div>
        </div>

        {/* 3 tabs */}
        <div style={{ display: "flex", gap: 2, margin: "0 20px 12px",
          background: "rgba(15,15,26,.06)", borderRadius: 12, padding: 4, flexShrink: 0 }}>
          {([["mark", t("walletDialog.tabMark")], ["topup", t("walletDialog.tabTopup")], ["history", t("walletDialog.tabHistory")]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ flex: 1, height: 36, borderRadius: 9, border: "none", cursor: "pointer",
                background: tab === key ? F.surface : "transparent",
                boxShadow: tab === key ? "0 1px 4px rgba(15,15,26,.12)" : "none",
                fontFamily: F.display, fontWeight: 700, fontSize: 14,
                color: tab === key ? F.tealD : F.muted }}>
              {label}
            </button>
          ))}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 20px" }}>

          {/* ── ВІДМІТИТИ ───────────────────────────────────────────────────── */}
          {tab === "mark" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 100 }}>
              {loadingUnpaid ? (
                <p style={{ textAlign: "center", padding: "24px 0", color: F.muted, fontFamily: F.body, fontSize: 14 }}>
                  {t("walletDialog.loading")}
                </p>
              ) : unpaidLessons.length === 0 ? (
                <div style={{ textAlign: "center", padding: "28px 0" }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>🎉</p>
                  <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 16, color: F.txt }}>
                    {t("walletDialog.allPaidTitle")}
                  </p>
                  <p style={{ fontSize: 14, color: F.sub, fontFamily: F.body, marginTop: 4 }}>
                    {t("walletDialog.allPaidDesc")}
                  </p>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 13, fontFamily: F.display, fontWeight: 700,
                    color: "#b45309", marginBottom: 4 }}>
                    {t("walletDialog.unpaidHeader", { count: unpaidLessons.length })}
                  </p>
                  {unpaidLessons.map(lesson => {
                    const checked = checkedIds.has(lesson.id);
                    return (
                      <button key={lesson.id} onClick={() => toggleCheck(lesson.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                          borderRadius: 14, cursor: "pointer", textAlign: "left",
                          border: checked ? `1.5px solid ${F.teal}` : `1px solid ${F.border}`,
                          background: checked ? F.tealL : F.surface,
                          boxShadow: checked ? "0 0 0 1px rgba(43,191,170,.15)" : "0 1px 3px rgba(15,15,26,.05)" }}>
                        {/* Checkbox */}
                        <div style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                          background: checked ? F.teal : "transparent",
                          border: checked ? "none" : `2px solid ${F.muted}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#0f0f1a", fontSize: 13, fontWeight: 700 }}>
                          {checked && "✓"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 15, color: F.txt }}>
                            {fmt(lesson.starts_at)}
                          </p>
                          <p style={{ fontSize: 13, color: F.sub, fontFamily: F.body }}>
                            {lesson.subject}
                          </p>
                        </div>
                        <p style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16,
                          color: checked ? F.tealD : F.txt, flexShrink: 0 }}>
                          {lesson.student_price}{lesson.currency === "UAH" ? "₴" : lesson.currency === "USD" ? "$" : "€"}
                        </p>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── ПОПОВНИТИ ───────────────────────────────────────────────────── */}
          {tab === "topup" && canTopUp && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 100 }}>
              {/* Mode toggle */}
              <div style={{ display: "flex", gap: 2, background: "rgba(15,15,26,.06)",
                borderRadius: 12, padding: 4 }}>
                {(["lessons", "amount"] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    style={{ flex: 1, height: 38, borderRadius: 9, border: "none", cursor: "pointer",
                      background: mode === m ? F.surface : "transparent",
                      boxShadow: mode === m ? "0 1px 4px rgba(15,15,26,.12)" : "none",
                      fontFamily: F.display, fontWeight: 700, fontSize: 14,
                      color: mode === m ? F.txt : F.muted }}>
                    {m === "lessons" ? t("walletDialog.modeLessons") : t("walletDialog.modeAmount")}
                  </button>
                ))}
              </div>

              {mode === "lessons" ? (
                <div>
                  <p style={{ fontFamily: F.display, fontSize: 13, fontWeight: 700,
                    color: F.sub, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                    {t("walletDialog.lessonsCountLabel")}
                  </p>
                  <input
                    type="number" min={1} placeholder="1"
                    value={lessonsCount}
                    onChange={e => setLessonsCount(e.target.value)}
                    style={{ width: "100%", height: 48, borderRadius: 13, padding: "0 14px",
                      fontSize: 20, fontFamily: F.display, fontWeight: 700, color: F.tealD,
                      background: F.bg, border: `1.5px solid ${F.border}`, outline: "none",
                      boxSizing: "border-box" as const }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {[1, 5, 10].map(n => (
                      <button key={n} onClick={() => setLessonsCount(c => String((parseInt(c)||0) + n))}
                        style={{ flex: 1, height: 40, borderRadius: 11,
                          border: `1.5px solid ${F.teal}`, background: F.tealL,
                          color: F.tealD, fontFamily: F.display, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                        +{n}
                      </button>
                    ))}
                  </div>
                  {ratePerLesson && lessonsCount && parseInt(lessonsCount) > 0 && (
                    <p style={{ fontSize: 13, color: F.sub, fontFamily: F.body, marginTop: 8 }}>
                      {t("walletDialog.rateHint", { total: parseInt(lessonsCount) * ratePerLesson, rate: ratePerLesson })}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p style={{ fontFamily: F.display, fontSize: 13, fontWeight: 700,
                    color: F.sub, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                    {t("walletDialog.amountLabel")}
                  </p>
                  <input
                    type="number" min={0} placeholder="0"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    style={{ width: "100%", height: 48, borderRadius: 13, padding: "0 14px",
                      fontSize: 20, fontFamily: F.display, fontWeight: 700, color: F.tealD,
                      background: F.bg, border: `1.5px solid ${F.border}`, outline: "none",
                      boxSizing: "border-box" as const }}
                  />
                </div>
              )}

              <div>
                <p style={{ fontFamily: F.display, fontSize: 13, fontWeight: 700,
                  color: F.sub, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                  {t("walletDialog.noteLabel")}
                </p>
                <input
                  placeholder={t("walletDialog.notePlaceholder")}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  style={{ width: "100%", height: 48, borderRadius: 13, padding: "0 14px",
                    fontSize: 15, fontFamily: F.body, color: F.txt,
                    background: F.bg, border: `1.5px solid ${F.border}`, outline: "none",
                    boxSizing: "border-box" as const }}
                />
              </div>
            </div>
          )}

          {/* ── ІСТОРІЯ ─────────────────────────────────────────────────────── */}
          {tab === "history" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 100 }}>
              {loading ? (
                <p style={{ textAlign: "center", padding: "24px 0", color: F.muted, fontFamily: F.body }}>
                  {t("walletDialog.loading")}
                </p>
              ) : transactions.length === 0 ? (
                <p style={{ textAlign: "center", padding: "24px 0", color: F.muted, fontFamily: F.body, fontSize: 14 }}>
                  {t("walletDialog.noTransactions")}
                </p>
              ) : (
                transactions.map(tx => {
                  const isPositive = (tx.lessons_delta ?? 0) > 0 || (tx.amount_delta ?? 0) > 0;
                  return (
                    <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 14px", borderRadius: 14, background: F.surface,
                      border: `1px solid ${F.border}` }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                        background: isPositive ? "rgba(43,191,170,.1)" : "rgba(239,68,68,.08)",
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 16 }}>{isPositive ? "↑" : "↓"}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: F.display, fontWeight: 600, fontSize: 14, color: F.txt }}>
                          {KIND_LABEL[tx.kind] ?? tx.kind}
                        </p>
                        {tx.note && <p style={{ fontSize: 13, color: F.sub, fontFamily: F.body }}>{tx.note}</p>}
                        <p style={{ fontSize: 13, color: F.muted, fontFamily: F.body }}>
                          {formatDateTime(tx.created_at)}
                        </p>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        {(tx.lessons_delta ?? 0) !== 0 && (
                          <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14,
                            color: (tx.lessons_delta ?? 0) > 0 ? F.tealD : "#ef4444" }}>
                            {(tx.lessons_delta ?? 0) > 0 ? "+" : ""}{tx.lessons_delta} {t("walletDialog.lessonsShort")}
                          </p>
                        )}
                        {(tx.amount_delta ?? 0) !== 0 && (
                          <p style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14,
                            color: (tx.amount_delta ?? 0) > 0 ? F.tealD : "#ef4444" }}>
                            {(tx.amount_delta ?? 0) > 0 ? "+" : ""}{tx.amount_delta}₴
                          </p>
                        )}
                      </div>
                      {canDelete && (
                        <button onClick={() => handleDelete(tx.id, false)}
                          disabled={!!deletingId}
                          style={{ width: 28, height: 28, borderRadius: 8, border: "none",
                            background: "transparent", cursor: "pointer", flexShrink: 0,
                            color: F.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Undo2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Sticky CTA */}
        <div style={{ padding: "12px 20px 20px", flexShrink: 0, borderTop: `1px solid ${F.border}`,
          background: F.surface }}>
          {tab === "mark" && unpaidLessons.length > 0 && (
            <button
              disabled={marking || checkedIds.size === 0}
              onClick={handleMarkPaid}
              style={{ width: "100%", height: 52, borderRadius: 14, border: "none",
                cursor: checkedIds.size > 0 && !marking ? "pointer" : "not-allowed",
                background: checkedIds.size > 0 ? "linear-gradient(135deg,#2BBFAA,#25a896)" : "rgba(43,191,170,.35)",
                color: "#0f0f1a", fontFamily: F.display, fontWeight: 700, fontSize: 16,
                boxShadow: checkedIds.size > 0 ? "0 8px 20px -8px rgba(43,191,170,.6)" : "none",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {marking ? "…" : t("walletDialog.markCta", { total: checkedTotal })}
            </button>
          )}

          {tab === "topup" && canTopUp && (
            <button
              disabled={busy}
              onClick={handleTopUp}
              style={{ width: "100%", height: 52, borderRadius: 14, border: "none", cursor: "pointer",
                background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a",
                fontFamily: F.display, fontWeight: 700, fontSize: 16,
                boxShadow: "0 8px 20px -8px rgba(43,191,170,.6)" }}>
              {busy ? "…" : t("walletDialog.topupCta")}
            </button>
          )}

          {tab === "history" && (
            <button onClick={() => { setTab("mark"); }}
              style={{ width: "100%", height: 44, borderRadius: 12, border: `1px solid ${F.border}`,
                background: F.surface, cursor: "pointer", color: F.sub,
                fontFamily: F.display, fontWeight: 600, fontSize: 15 }}>
              {t("walletDialog.backToPayment")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
