import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Send, Copy, Share2, MessageCircle, X, Check } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { currencySymbol } from "@/lib/currency";
import { logEvent } from "@/lib/analytics";
import { buildShareText, canNativeShare, payLinkUrl, shareHref, type PayLinkIssue, type ShareTarget } from "@/lib/payLink";

/**
 * Аркуш «Нагадати» (13.10, пре-мортем: нагадування без акаунта учня).
 *
 * Один аркуш — два шляхи, обидва з тим самим магічним посиланням:
 *  · «Надіслати автоматично» — якщо в учня є Telegram-бот чи пошта, застосунок
 *    шле сам (edge remind-payment, 5 с на «Скасувати» — як і раніше), і в
 *    повідомленні вже лежить посилання з кнопкою «Я оплатив(ла)»;
 *  · «Переслати самому» — готовий текст + посилання у Viber/Telegram/WhatsApp/
 *    SMS або системне «поділитися». Це шлях для 100 % учнів: батьки нічого не
 *    встановлюють, а репетитор і так пише їм у месенджер.
 * Пересилання лишає слід у журналі (payment_link_shared) — підпис «нагадано
 * сьогодні» і лічильник «нагадано за вас» бачать обидва шляхи.
 */
export function RemindSheet({
  open, onOpenChange, studentId, tutorId, studentName, canAuto, onAutoSend, onShared,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentId: string;
  tutorId?: string | null;
  studentName?: string;
  /** Чи є кому слати автоматично — вирішує сам аркуш після RPC, але батько може заборонити. */
  canAuto?: boolean;
  onAutoSend: () => void;
  onShared?: () => void;
}) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<PayLinkIssue | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) { setIssue(null); setFailed(false); setCopied(false); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      const { data, error } = await (supabase.rpc as any)("issue_payment_link", { _student_id: studentId, _tutor_id: tutorId ?? null });
      if (!alive) return;
      setLoading(false);
      if (error || !data?.token) { setFailed(true); return; }
      setIssue(data as PayLinkIssue);
    })();
    return () => { alive = false; };
  }, [open, studentId, tutorId]);

  const sym = currencySymbol(issue?.currency ?? "UAH");
  const url = useMemo(() => (issue ? payLinkUrl(window.location.origin, issue.short_code || issue.token) : ""), [issue]);
  const text = useMemo(() => issue ? buildShareText({
    studentFirstName: issue.student_first_name || studentName?.split(" ")[0] || "",
    tutorName: issue.tutor_name,
    lessons: issue.lessons,
    total: Number(issue.total),
    currencySymbol: sym,
    url,
    t,
  }) : "", [issue, studentName, sym, url, t]);

  const autoPossible = !!issue && (issue.telegram || issue.email) && canAuto !== false;
  const noDebt = !!issue && issue.lessons === 0;

  const logShare = (channel: string) => {
    logEvent("payment_link_shared", { channel });
    void (supabase.rpc as any)("payment_link_shared", { _student_id: studentId, _tutor_id: tutorId ?? null, _channel: channel });
    onShared?.();
  };
  const share = async (target: ShareTarget | "native" | "copy") => {
    if (!issue) return;
    if (target === "copy") {
      try { await navigator.clipboard.writeText(text); setCopied(true); toast.success(t("payLink.copied")); } catch { toast.error(t("payLink.copyFailed")); return; }
      logShare("copy");
      return;
    }
    if (target === "native") {
      try { await navigator.share({ text }); logShare("native"); } catch { /* людина закрила вікно */ }
      return;
    }
    window.open(shareHref(target, text), "_blank", "noopener,noreferrer");
    logShare(target);
  };

  const autoLabel = issue?.telegram && issue?.email
    ? t("payLink.autoBoth")
    : issue?.telegram ? t("payLink.autoTelegram") : t("payLink.autoEmail");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-full max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">{t("payLink.sheetTitle", { name: studentName ?? "" })}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div className="text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>
              {t("payLink.sheetTitle", { name: studentName ?? "" })}
            </div>
            {issue && !noDebt && (
              <div className="text-muted-foreground" style={{ fontSize: 14, marginTop: 2 }}>
                {Number(issue.total) > 0
                  ? t("payLink.summary", { count: issue.lessons, sum: `${Math.round(Number(issue.total))} ${sym}` })
                  : t("payLink.summaryNoSum", { count: issue.lessons })}
              </div>
            )}
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={t("common.close")}
            className="bg-secondary text-muted-foreground" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0" style={{ padding: "4px 20px 20px" }}>
          {loading && (
            <div className="flex items-center justify-center py-10" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {failed && !loading && (
            <p className="text-[15px] text-destructive">{t("payLink.loadFailed")}</p>
          )}
          {noDebt && !loading && (
            <p className="text-[15px] text-foreground">🎉 {t("payLink.noDebt", { name: studentName ?? "" })}</p>
          )}
          {issue && !noDebt && !loading && (
            <>
              {/* 1. Автоматично — якщо є кому */}
              {autoPossible ? (
                <button type="button" onClick={() => { onAutoSend(); onOpenChange(false); }}
                  className="bg-primary text-primary-foreground w-full"
                  style={{ height: 50, borderRadius: 14, border: "none", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Send size={18} /> {autoLabel}
                </button>
              ) : (
                <div className="rounded-[14px] bg-secondary px-4 py-3 text-[14px] text-muted-foreground">
                  {t("payLink.noAutoChannels")}
                </div>
              )}

              {/* 2. Переслати самому */}
              <p className="mt-5 mb-2 text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {autoPossible ? t("payLink.orShare") : t("payLink.shareYourself")}
              </p>
              <div className="rounded-[14px] border-[0.5px] border-border bg-secondary/50 px-4 py-3 text-[14px] text-foreground whitespace-pre-line" style={{ lineHeight: 1.45, overflowWrap: "anywhere" }}>
                {text}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {canNativeShare() && (
                  <ShareBtn onClick={() => share("native")} icon={<Share2 size={18} />} label={t("payLink.shareNative")} primary />
                )}
                <ShareBtn onClick={() => share("telegram")} icon={<span aria-hidden style={{ fontWeight: 800 }}>✈</span>} label="Telegram" />
                <ShareBtn onClick={() => share("viber")} icon={<MessageCircle size={18} />} label="Viber" />
                <ShareBtn onClick={() => share("whatsapp")} icon={<MessageCircle size={18} />} label="WhatsApp" />
                <ShareBtn onClick={() => share("sms")} icon={<MessageCircle size={18} />} label="SMS" />
                <ShareBtn onClick={() => share("copy")} icon={copied ? <Check size={18} /> : <Copy size={18} />} label={copied ? t("payLink.copied") : t("payLink.copy")} />
              </div>
              <p className="mt-4 text-[13px] text-muted-foreground" style={{ lineHeight: 1.45 }}>
                {t("payLink.howItWorks")}
                {issue.has_requisites === false && (
                  <> <span className="text-warning font-semibold">{t("payLink.noRequisites")}</span></>
                )}
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareBtn({ onClick, icon, label, primary }: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={primary ? "col-span-2 bg-primary text-primary-foreground" : "bg-card text-foreground border-[0.5px] border-border"}
      style={{ height: 46, borderRadius: 12, cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
      {icon} {label}
    </button>
  );
}
