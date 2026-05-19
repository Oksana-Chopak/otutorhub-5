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
              ? t("walletDialogExtra.pairLabel", { student: studentName ?? t("shared.student"), tutor: tutorName })
              : t("walletDialogExtra.pairLabelGeneric")}
          </DialogDescription>
        </DialogHeader>

        {/* Balance summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-background/50 p-3 text-center">
            <div className="text-xs text-muted-foreground">{t("walletDialogExtra.lessonsBalance")}</div>
            <div className="mt-1 text-2xl font-semibold">
              {loading ? "—" : balance.lessons_balance}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3 text-center">
            <div className="text-xs text-muted-foreground">{t("walletDialogExtra.moneyBalance")}</div>
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
                  <TabsTrigger value="lessons">{t("walletDialogExtra.byLessons")}</TabsTrigger>
                  <TabsTrigger value="amount">{t("walletDialogExtra.byAmount")}</TabsTrigger>
                </TabsList>

                <TabsContent value="lessons" className="space-y-2 pt-3">
                  <Label className="text-xs">{t("walletDialogExtra.lessonsCountLabel")}</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder={t("walletDialogExtra.countPlaceholder")}
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
                  <Label className="text-xs">{t("walletDialogExtra.amountLabel")}</Label>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder={t("walletDialogExtra.amountPlaceholder")}
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
                <Label className="text-xs">{t("walletDialogExtra.commentLabel")}</Label>
                <Input
                  placeholder={t("walletDialogExtra.commentPlaceholder")}
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
                      <div className="flex items-start gap-2">
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
                        {canDelete && tx.kind !== "lesson_charge" && (
                          <div className="flex flex-col gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title={t("walletDialogExtra.reverseTooltip")}
                              disabled={deletingId === tx.id}
                              onClick={() => handleDelete(tx.id, false)}
                            >
                              {deletingId === tx.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Undo2 className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              title={t("walletDialogExtra.hardDeleteTooltip")}
                              disabled={deletingId === tx.id}
                              onClick={() => handleDelete(tx.id, true)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
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
