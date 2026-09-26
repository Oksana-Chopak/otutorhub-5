import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BadgeCheck, Clock, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/currency";
import { getLocale } from "@/lib/locale";
import { useHaptic } from "@/hooks/useHaptic";

export type PendingClaim = { id: string; tutor_id: string; amount: number; currency: string; created_at: string };

/**
 * «Я оплатив» — кнопка учня (важіль 4 аудиту шляхів 24.09, рішення власниці
 * «заявка + підтвердження»).
 *
 * Що вона НЕ робить: не міняє гроші. Учень не може позначити собі оплату —
 * інакше борг закривався б словом. Вона створює ЗАЯВКУ, яку бачить той, хто
 * гроші отримує (самостійний репетитор або менеджер школи), і підтвердження
 * йде канонічним шляхом грошей — поповненням гаманця пари.
 *
 * Чому це важливо: до цього після «скопіювати реквізити» наставала тиша —
 * учень не знав, чи побачили його переказ, репетитор не знав, що гроші в
 * дорозі. Звідси весь клас конфліктів «я ж переказала».
 */
export function IPaidButton({
  tutorId,
  tutorName,
  amountDue,
  currency,
  pending,
  onCreated,
  autoOpen,
}: {
  tutorId: string;
  tutorName?: string;
  /** Скільки учень винен цьому репетитору — підставляємо як суму заявки. */
  amountDue: number;
  currency: string;
  /** Заявка, яка вже чекає підтвердження (щоб не надсилати другу). */
  pending?: PendingClaim | null;
  onCreated?: () => void;
  /** Прийшли з кнопки сповіщення (`?paid=<tutorId>`) — відкриваємо аркуш самі. */
  autoOpen?: boolean;
}) {
  const { t } = useTranslation();
  const haptic = useHaptic();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(amountDue > 0 ? String(amountDue) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAmount(amountDue > 0 ? String(amountDue) : "");
  }, [open, amountDue]);

  /* Відкриваємо лише коли заявки ще немає: прийшов із сповіщення, а заявка вже
     в дорозі — не показуємо форму вдруге, показуємо «чекаємо підтвердження». */
  useEffect(() => {
    if (autoOpen && !pending) setOpen(true);
  }, [autoOpen, pending]);

  if (pending) {
    const at = new Date(pending.created_at);
    return (
      <div
        className="mt-2.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-[12px] px-3 text-center"
        style={{ background: "rgba(245,158,11,.14)", border: "1px solid rgba(245,158,11,.4)", color: "var(--warning-text,#B45309)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14 }}
      >
        <Clock className="h-4 w-4 shrink-0" />
        {t("iPaid.waiting", {
          amount: formatPrice(pending.amount, pending.currency),
          when: Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString(getLocale(), { day: "numeric", month: "short" }),
        })}
      </div>
    );
  }

  const send = async () => {
    const value = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) { toast.error(t("iPaid.amountNeeded")); return; }
    setBusy(true);
    let res: { data?: any; error?: { message: string } | null } = {};
    try {
      res = await (supabase.rpc as any)("create_payment_claim", { _tutor_id: tutorId, _amount: value, _note: note.trim() || null });
    } catch (e) {
      res = { error: { message: e instanceof Error ? e.message : String(e) } };
    } finally {
      setBusy(false);
    }
    if (res.error || !res.data?.ok) {
      // Ліміт («too_many») — не помилка людини, тож окремий текст.
      if (res.data?.reason === "too_many") { toast.error(t("iPaid.tooMany")); return; }
      toast.error(t("iPaid.failed"), { description: res.error?.message });
      return;
    }
    haptic.success();
    setOpen(false);
    setNote("");
    toast.success(t("iPaid.sent"), { description: tutorName });
    onCreated?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { haptic.tap(); setOpen(true); }}
        className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] transition-opacity active:opacity-90"
        style={{ background: "var(--ds-surface,#fff)", color: "var(--teal-text,#1a7a6c)", border: "1.5px solid #2BBFAA", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 15 }}
      >
        <BadgeCheck className="h-4 w-4" />
        {t("iPaid.action")}
      </button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent aria-describedby={undefined} className="w-full max-w-sm p-5 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto">
          <DialogTitle className="text-[19px] font-extrabold">{t("iPaid.title")}</DialogTitle>
          <p className="text-[15px] text-muted-foreground" style={{ lineHeight: 1.45 }}>
            {t("iPaid.desc", { name: tutorName ?? "" })}
          </p>
          <label className="text-[14px] font-semibold" htmlFor="ipaid-amount">{t("iPaid.amountLabel", { currency })}</label>
          <input
            id="ipaid-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-11 w-full rounded-xl border border-input px-3 text-[15px]"
            style={{ color: "var(--ds-txt,#0f0f1a)", background: "var(--ds-surface,#fff)" }}
          />
          <input
            aria-label={t("iPaid.noteLabel")}
            placeholder={t("iPaid.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="h-11 w-full rounded-xl border border-input px-3 text-[15px]"
            style={{ color: "var(--ds-txt,#0f0f1a)", background: "var(--ds-surface,#fff)" }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] text-[16px] font-bold"
            style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", border: "none", cursor: busy ? "wait" : "pointer" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
            {t("iPaid.send")}
          </button>
          <p className="text-center text-[14px]" style={{ color: "var(--sub,#62677E)" }}>{t("iPaid.hint")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
