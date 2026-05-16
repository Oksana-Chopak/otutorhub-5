import { useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Receipt,
  Wallet,
  Loader2,
  Plus,
  ArrowLeft,
  Search,
  Check,
} from "lucide-react";
import { toast } from "sonner";

export interface PairOption {
  tutor_id: string;
  student_id: string;
  tutor_name: string;
  student_name: string;
  rate?: number;
}

export interface UnpaidLessonOption {
  id: string;
  subject: string;
  starts_at: string;
  student_price: number;
  student_id: string;
  tutor_id: string;
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
  new Date(iso).toLocaleDateString("uk-UA", {
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
  const [tab, setTab] = useState<"lesson" | "prepay">("lesson");
  const [search, setSearch] = useState("");
  const [pickedPair, setPickedPair] = useState<PairOption | null>(null);

  // Prepay form
  const [mode, setMode] = useState<"lessons" | "amount">("lessons");
  const [lessonsCount, setLessonsCount] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
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
    setMarkingId(lessonId);
    await onMarkLessonPaid(lessonId);
    setMarkingId(null);
  };

  const handleTopUp = async () => {
    if (!pickedPair) return;
    let lessonsDelta = 0;
    let amountDelta = 0;
    if (mode === "lessons") {
      const n = parseInt(lessonsCount, 10);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Вкажіть додатну кількість уроків");
        return;
      }
      lessonsDelta = n;
    } else {
      const a = parseFloat(amount.replace(",", "."));
      if (!Number.isFinite(a) || a <= 0) {
        toast.error("Вкажіть додатну суму");
        return;
      }
      amountDelta = a;
    }
    setBusy(true);
    const submittedAt = new Date().toISOString();
    const { error } = await supabase.rpc("wallet_topup" as any, {
      _tutor_id: pickedPair.tutor_id,
      _student_id: pickedPair.student_id,
      _lessons_delta: lessonsDelta,
      _amount_delta: amountDelta,
      _note: note || null,
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
        writtenTx = data as { id: string } | null;
      }

      if (!writtenTx) {
        setBusy(false);
        toast.error("Не вдалося поповнити", { description: error.message });
        return;
      }
    }

    toast.success("Передоплату збережено");
    await onWalletTopUp();
    setBusy(false);
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Зафіксувати оплату</DialogTitle>
          <DialogDescription>
            Виберіть тип: оплата за конкретний урок або передоплата на майбутні.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setPickedPair(null); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="lesson">
              <Receipt className="mr-1.5 h-4 w-4" /> За урок
            </TabsTrigger>
            <TabsTrigger value="prepay">
              <Wallet className="mr-1.5 h-4 w-4" /> Передоплата
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
                    У цієї пари немає неоплачених уроків. Можливо, варто зробити передоплату?
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
                          <div className="text-xs text-muted-foreground">
                            {formatDate(l.starts_at)} · {l.student_price} ₴
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
                          Оплачено
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
                <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="lessons">Уроками</TabsTrigger>
                    <TabsTrigger value="amount">Сумою</TabsTrigger>
                  </TabsList>
                  <TabsContent value="lessons" className="space-y-2 pt-3">
                    <Label className="text-xs">Кількість уроків</Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="напр. 5"
                      value={lessonsCount}
                      onChange={(e) => setLessonsCount(e.target.value)}
                    />
                    {pickedPair.rate && lessonsCount && (
                      <p className="text-xs text-muted-foreground">
                        ≈ {(parseInt(lessonsCount, 10) * pickedPair.rate).toFixed(0)} ₴ за поточною ставкою
                      </p>
                    )}
                  </TabsContent>
                  <TabsContent value="amount" className="space-y-2 pt-3">
                    <Label className="text-xs">Сума, ₴</Label>
                    <Input
                      type="number"
                      min="1"
                      step="0.01"
                      placeholder="напр. 1800"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    {pickedPair.rate && amount && (
                      <p className="text-xs text-muted-foreground">
                        ≈ {Math.floor(parseFloat(amount.replace(",", ".")) / pickedPair.rate)} уроків
                      </p>
                    )}
                  </TabsContent>
                </Tabs>
                <div>
                  <Label className="text-xs">Коментар (необов'язково)</Label>
                  <Input
                    placeholder="напр. готівка 16.05"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <Button onClick={handleTopUp} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Зберегти передоплату
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
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
        <Input
          placeholder="Пошук пари учень/репетитор…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      {pairs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Жодної пари не знайдено
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
                  <span className="block truncate text-xs text-muted-foreground">
                    ↔ {p.tutor_name}
                  </span>
                </span>
                {p.rate ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {p.rate} ₴/ур.
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
        <div className="truncate text-xs text-muted-foreground">↔ {pair.tutor_name}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
        Інша пара
      </Button>
    </div>
  );
}
