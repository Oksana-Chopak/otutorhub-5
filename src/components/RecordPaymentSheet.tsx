import { useMemo, useState } from "react";
import { DateTimeField } from "@/components/DateTimeField";
import { getLocale } from "@/lib/locale";
import { formatPrice } from "@/lib/currency";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Receipt,
  Wallet,
  Loader2,
  Plus,
  ArrowLeft,
  Search,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useHaptic } from "@/hooks/useHaptic";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

export interface PairOption {
  tutor_id: string;
  student_id: string;
  tutor_name: string;
  student_name: string;
  rate?: number;
  currency?: string | null;
}

export interface UnpaidLessonOption {
  id: string;
  subject: string;
  starts_at: string;
  student_price: number;
  student_id: string;
  tutor_id: string;
  currency?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pairs: PairOption[];
  unpaidLessons: UnpaidLessonOption[];
  /** Викликається коли треба позначити урок оплаченим (оптимістично оновлює список у батьку). */
  onMarkLessonPaid: (lessonId: string) => Promise<void>;
  /** Викликається після успішного поповнення гаманця для рефрешу. */
  onWalletTopUp: () => Promise<void> | void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(getLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export function RecordPaymentSheet({
  open,
  onOpenChange,
  pairs,
  unpaidLessons,
  onMarkLessonPaid,
  onWalletTopUp,
}: Props) {
  const haptic = useHaptic();
  const [tab, setTab] = useState<"lesson" | "prepay">("lesson");
  const [search, setSearch] = useState("");
  const [pickedPair, setPickedPair] = useState<PairOption | null>(null);

  // Prepay form
  const [mode, setMode] = useState<"lessons" | "amount">("lessons");
  const [lessonsCount, setLessonsCount] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // 04.09: дата внесення вручну — передоплату часто позначають ПІЗНІШЕ, ніж учень заплатив.
  const [paidOn, setPaidOn] = useState<string>(() => {
    const d = new Date(); d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const reset = () => {
    setPickedPair(null);
    setSearch("");
    setLessonsCount("");
    setAmount("");
    setNote("");
    setMode("lessons");
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 200);
  };

  const filteredPairs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter(
      (p) =>
        p.student_name.toLowerCase().includes(q) ||
        p.tutor_name.toLowerCase().includes(q),
    );
  }, [pairs, search]);

  const pairUnpaid = useMemo(() => {
    if (!pickedPair) return [];
    return unpaidLessons
      .filter(
        (l) =>
          l.tutor_id === pickedPair.tutor_id &&
          l.student_id === pickedPair.student_id,
      )
      .sort(
        (a, b) =>
          new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
      );
  }, [unpaidLessons, pickedPair]);

  const handleMarkPaid = async (lessonId: string) => {
    // Instant-feedback invariant: buzz on the tap, not after the network round-trip
    // (the parent callback already updates the list optimistically).
    haptic.success();
    setMarkingId(lessonId);
    await onMarkLessonPaid(lessonId);
    setMarkingId(null);
  };

  const handleTopUp = async () => {
    if (busy) return; // P7: подвійний тап = гаманець на 20 уроків замість 10 (як у WalletDialog)
    if (!pickedPair) return;
    let lessonsDelta = 0;
    let amountDelta = 0;
    if (mode === "lessons") {
      const n = parseInt(lessonsCount, 10);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error(t("recordPayment.lessonsRequired"));
        return;
      }
      lessonsDelta = n;
    } else {
      const a = parseFloat(amount.replace(",", "."));
      if (!Number.isFinite(a) || a <= 0) {
        toast.error(t("recordPayment.amountRequired"));
        return;
      }
      amountDelta = a;
    }
    setBusy(true);
    try {
      const submittedAt = new Date().toISOString();
      const { error } = await supabase.rpc("wallet_topup" as any, {
        _tutor_id: pickedPair.tutor_id,
        _student_id: pickedPair.student_id,
        _lessons_delta: lessonsDelta,
        _amount_delta: amountDelta,
        _note: note || null,
        _paid_at: paidOn ? new Date(paidOn).toISOString() : null,
      });

      if (error) {
        let writtenTx: { id: string } | null = null;
        for (let attempt = 0; attempt < 3 && !writtenTx; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 350));
          const { data } = await supabase
            .from("student_wallet_transactions" as any)
            .select("id")
            .eq("tutor_id", pickedPair.tutor_id)
            .eq("student_id", pickedPair.student_id)
            .eq("kind", "topup")
            .eq("lessons_delta", lessonsDelta)
            .eq("amount_delta", amountDelta)
            .gte("created_at", submittedAt)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          writtenTx = data as unknown as { id: string } | null;
        }

        if (!writtenTx) {
          setBusy(false);
          haptic.error();
          toast.error(t("recordPayment.saveFailed"), { description: error.message });
          return;
        }
      }

      haptic.success();
      toast.success(t("recordPayment.saved"));
      // B6: гроші ВЖЕ записані — якщо рефреш батька впаде, кнопка не має
      // лишитись мертвою до перезавантаження.
      try {
        await onWalletTopUp();
      } finally {
        setBusy(false);
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="w-full max-w-lg p-0 gap-0 rounded-t-[26px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        {/* C3: VoiceOver казав просто «діалог» — тепер діалог названо */}
        <DialogTitle className="sr-only">{t("recordPayment.title")}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 21, letterSpacing: "-.01em", color: "var(--ds-txt,#0f0f1a)" }}>
              {t("recordPayment.title")}
            </div>
            <div style={{ fontSize: 15, color: "var(--sub,#666b82)", marginTop: 2 }}>
              {t("recordPaymentExtra.subtitle")}
            </div>
          </div>
          <button onClick={close} aria-label={t("common.close")}
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "var(--ds-bg,#F5F4F0)", color: "var(--sub,#666b82)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 20px 20px" }}>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setPickedPair(null); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="lesson">
              <Receipt className="mr-1.5 h-4 w-4" /> {t("recordPaymentExtra.tabLesson")}
            </TabsTrigger>
            <TabsTrigger value="prepay">
              <Wallet className="mr-1.5 h-4 w-4" /> {t("recordPaymentExtra.tabPrepay")}
            </TabsTrigger>
          </TabsList>

          {/* --- LESSON TAB --- */}
          <TabsContent value="lesson" className="space-y-3 pt-3">
            {!pickedPair ? (
              <>
                <PairPicker
                  pairs={filteredPairs}
                  search={search}
                  setSearch={setSearch}
                  onPick={setPickedPair}
                />
              </>
            ) : (
              <>
                <PickedHeader pair={pickedPair} onBack={() => setPickedPair(null)} />
                {pairUnpaid.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("recordPaymentExtra.noUnpaidLessons")}
                  </p>
                ) : (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {pairUnpaid.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 p-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{l.subject}</div>
                          <div className="text-[14px] text-muted-foreground">
                            {formatDate(l.starts_at)} · {formatPrice(Number(l.student_price), l.currency ?? "UAH")}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markingId === l.id}
                          onClick={() => handleMarkPaid(l.id)}
                        >
                          {markingId === l.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          {t("recordPaymentExtra.markPaid")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </TabsContent>

          {/* --- PREPAY TAB --- */}
          <TabsContent value="prepay" className="space-y-3 pt-3">
            {!pickedPair ? (
              <PairPicker
                pairs={filteredPairs}
                search={search}
                setSearch={setSearch}
                onPick={setPickedPair}
              />
            ) : (
              <>
                <PickedHeader pair={pickedPair} onBack={() => setPickedPair(null)} />

                {/* ДС-сегмент: за уроками / на суму */}
                <div style={{ display: "flex", gap: 2, background: "rgba(15,15,26,.06)", borderRadius: 12, padding: 4 }}>
                  {([["lessons", t("recordPayment.byLessons")], ["amount", t("recordPaymentExtra.byAmount")]] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setMode(key as any)}
                      style={{ flex: 1, height: 38, borderRadius: 9, border: "none", cursor: "pointer",
                        background: mode === key ? "#fff" : "transparent",
                        boxShadow: mode === key ? "0 1px 4px rgba(15,15,26,.12)" : "none",
                        fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14,
                        color: mode === key ? "#1f8e7e" : "#6f7489" }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Велике поле на ДС-картці */}
                <div style={{ borderRadius: 16, padding: 14, background: "var(--ds-surface2,#fbfbfc)", border: "1px solid var(--ds-border,#eceef3)" }}>
                  <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub,#666b82)", marginBottom: 8 }}>
                    {mode === "lessons" ? t("recordPaymentExtra.countLabel") : t("recordPaymentExtra.amountLabel")}
                  </p>
                  {mode === "lessons" ? (
                    <input aria-label={t("recordPaymentExtra.countPlaceholder")}
                      type="number" min="1" inputMode="numeric"
                      placeholder={t("recordPaymentExtra.countPlaceholder")}
                      value={lessonsCount}
                      onChange={(e) => setLessonsCount(e.target.value)}
                      style={{ width: "100%", height: 52, borderRadius: 13, border: "1.5px solid var(--ds-border,#eceef3)", padding: "0 14px",
                        fontSize: 22, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, color: "#1f8e7e",
                        background: "var(--ds-surface,#fff)", outline: "none" }}
                    />
                  ) : (
                    <input aria-label={t("recordPaymentExtra.amountPlaceholder")}
                      type="number" min="1" step="0.01" inputMode="decimal"
                      placeholder={t("recordPaymentExtra.amountPlaceholder")}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      style={{ width: "100%", height: 52, borderRadius: 13, border: "1.5px solid var(--ds-border,#eceef3)", padding: "0 14px",
                        fontSize: 22, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, color: "#1f8e7e",
                        background: "var(--ds-surface,#fff)", outline: "none" }}
                    />
                  )}
                  {mode === "lessons" && pickedPair.rate && lessonsCount ? (
                    <p style={{ marginTop: 8, fontSize: 14, color: "var(--sub,#666b82)" }}>
                      ≈ <b style={{ color: "var(--ds-txt,#0f0f1a)" }}>{formatPrice(parseInt(lessonsCount, 10) * pickedPair.rate, pickedPair.currency ?? "UAH")}</b> {t("recordPaymentExtra.atCurrentRate")}
                    </p>
                  ) : null}
                  {mode === "amount" && pickedPair.rate && amount ? (
                    <p style={{ marginTop: 8, fontSize: 14, color: "var(--sub,#666b82)" }}>
                      ≈ <b style={{ color: "var(--ds-txt,#0f0f1a)" }}>{t("recordPaymentExtra.lessonsCount", { count: Math.floor(parseFloat(amount.replace(",", ".")) / pickedPair.rate) })}</b>
                    </p>
                  ) : null}
                </div>

                {/* 04.09: Дата внесення — вручну. Кейс: учень заплатив у понеділок,
                    менеджер позначив у четвер; транзакція має жити в понеділку. */}
                <div>
                  <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub,#666b82)", marginBottom: 6 }}>
                    {t("recordPaymentExtra.paidOnLabel")}
                  </p>
                  <DateTimeField value={paidOn} onChange={setPaidOn} />
                </div>

                {/* Коментар */}
                <div>
                  <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sub,#666b82)", marginBottom: 6 }}>
                    {t("recordPaymentExtra.commentLabel")}
                  </p>
                  <input aria-label={t("recordPaymentExtra.commentPlaceholder")}
                    placeholder={t("recordPaymentExtra.commentPlaceholder")}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={{ width: "100%", height: 46, borderRadius: 12, border: "1.5px solid var(--ds-border,#eceef3)", padding: "0 13px",
                      fontSize: 15, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: "var(--ds-txt,#0f0f1a)",
                      background: "var(--ds-surface,#fff)", outline: "none" }}
                  />
                </div>

                <button type="button" onClick={handleTopUp} disabled={busy}
                  style={{ width: "100%", height: 50, borderRadius: 14, border: "none",
                    cursor: busy ? "default" : "pointer",
                    background: busy ? "rgba(43,191,170,.4)" : "linear-gradient(135deg,#2BBFAA,#25a896)",
                    color: "#0f0f1a", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    boxShadow: busy ? "none" : "0 8px 20px -8px rgba(43,191,170,.6)" }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {t("recordPaymentExtra.savePrepay")}
                </button>
              </>
            )}
          </TabsContent>
        </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PairPicker({
  pairs,
  search,
  setSearch,
  onPick,
}: {
  pairs: PairOption[];
  search: string;
  setSearch: (v: string) => void;
  onPick: (p: PairOption) => void;
}) {
  return (
    <>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label={t("recordPaymentExtra.searchPlaceholder")}
          placeholder={t("recordPaymentExtra.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      {pairs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("recordPaymentExtra.noPairsFound")}
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {pairs.map((p) => (
            <li key={`${p.tutor_id}:${p.student_id}`}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-left text-sm hover:bg-secondary/60"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">
                    {p.student_name}
                  </span>
                  <span className="block truncate text-[14px] text-muted-foreground">
                    ↔ {p.tutor_name}
                  </span>
                </span>
                {p.rate ? (
                  <Badge variant="outline" className="shrink-0 text-[14px]">
                    {t("recordPaymentExtra.ratePerLessonCur", { price: formatPrice(p.rate ?? 0, p.currency ?? "UAH") })}
                  </Badge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PickedHeader({ pair, onBack }: { pair: PairOption; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{pair.student_name}</div>
        <div className="truncate text-[14px] text-muted-foreground">↔ {pair.tutor_name}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
        {t("recordPaymentExtra.otherPair")}
      </Button>
    </div>
  );
}
