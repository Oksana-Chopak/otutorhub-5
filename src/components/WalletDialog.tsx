import { useState } from "react";
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
  new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const KIND_LABEL: Record<string, string> = {
  topup: "Поповнення",
  lesson_charge: "Списання за урок",
  refund: "Повернення",
  adjustment: "Корекція",
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
        toast.error("Вкажіть додатну кількість уроків");
        return;
      }
      lessonsDelta = n;
      if (ratePerLesson && ratePerLesson > 0) {
        // не списуємо суму — рахуємо її в історії як 0; гаманець-уроки списуються по 1
      }
    } else {
      const a = parseFloat(amount.replace(",", "."));
      if (!Number.isFinite(a) || a <= 0) {
        toast.error("Вкажіть додатну суму");
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
      toast.error("Не вдалося поповнити", { description: error.message });
      return;
    }
    toast.success("Гаманець поповнено");
    reset();
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Гаманець
            {studentName && <span className="text-muted-foreground font-normal">· {studentName}</span>}
          </DialogTitle>
          <DialogDescription>
            {tutorName
              ? `Передплати в межах пари ${studentName ?? "учень"} ↔ ${tutorName}`
              : "Передплати учня"}
          </DialogDescription>
        </DialogHeader>

        {/* Balance summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-background/50 p-3 text-center">
            <div className="text-xs text-muted-foreground">Уроки на балансі</div>
            <div className="mt-1 text-2xl font-semibold">
              {loading ? "—" : balance.lessons_balance}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3 text-center">
            <div className="text-xs text-muted-foreground">Сума на балансі</div>
            <div className="mt-1 text-2xl font-semibold">
              {loading ? "—" : `${balance.amount_balance.toFixed(0)} ₴`}
            </div>
          </div>
        </div>

        <Tabs defaultValue={canTopUp ? "topup" : "history"}>
          <TabsList className="grid w-full grid-cols-2">
            {canTopUp && (
              <TabsTrigger value="topup">
                <Plus className="mr-1.5 h-4 w-4" /> Поповнити
              </TabsTrigger>
            )}
            <TabsTrigger value="history">
              <History className="mr-1.5 h-4 w-4" /> Історія
            </TabsTrigger>
          </TabsList>

          {canTopUp && (
            <TabsContent value="topup" className="space-y-3 pt-3">
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
                  {ratePerLesson && lessonsCount && (
                    <p className="text-xs text-muted-foreground">
                      ≈ {(parseInt(lessonsCount, 10) * ratePerLesson).toFixed(0)} ₴ за поточною ставкою
                      ({ratePerLesson} ₴/урок)
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="amount" className="space-y-2 pt-3">
                  <Label className="text-xs">Сума, ₴</Label>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="напр. 2500"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  {ratePerLesson && amount && (
                    <p className="text-xs text-muted-foreground">
                      ≈ {Math.floor(parseFloat(amount.replace(",", ".")) / ratePerLesson)} уроків
                      за поточною ставкою
                    </p>
                  )}
                </TabsContent>
              </Tabs>

              <div>
                <Label className="text-xs">Коментар (необов'язково)</Label>
                <Input
                  placeholder="напр. готівка, переказ 02.05"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <Button onClick={handleTopUp} disabled={busy} className="w-full">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Поповнити
              </Button>
            </TabsContent>
          )}

          <TabsContent value="history" className="pt-3">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : transactions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Поки що операцій немає.
              </p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {transactions.map((tx) => {
                  const isPositive = tx.lessons_delta > 0 || tx.amount_delta > 0;
                  return (
                    <li
                      key={tx.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-border bg-background/40 p-2.5 text-sm"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {isPositive ? (
                          <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        ) : (
                          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{KIND_LABEL[tx.kind] ?? tx.kind}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(tx.created_at)}
                          </div>
                          {tx.note && (
                            <div className="text-xs text-foreground/70 truncate">{tx.note}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-sm tabular-nums">
                        {tx.lessons_delta !== 0 && (
                          <div className={isPositive ? "text-success" : "text-warning"}>
                            {tx.lessons_delta > 0 ? "+" : ""}
                            {tx.lessons_delta} ур.
                          </div>
                        )}
                        {Number(tx.amount_delta) !== 0 && (
                          <div className={isPositive ? "text-success" : "text-warning"}>
                            {tx.amount_delta > 0 ? "+" : ""}
                            {Number(tx.amount_delta).toFixed(0)} ₴
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
