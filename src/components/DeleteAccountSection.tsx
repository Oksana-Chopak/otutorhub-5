import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Danger-zone «Видалити акаунт» — вимога App Store 5.1.1(v) і Google Play:
 * застосунок зі створенням акаунта мусить давати його видалити зсередини.
 * Викликає edge-функцію delete-account (service role), далі signOut.
 */
export function DeleteAccountSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      try {
        const { data, error } = await supabase.functions.invoke("delete-account");
        if (error || (data as { error?: string } | null)?.error) {
          /* 14.09, скарга живого користувача: «зареєструвалась помилково як
             учень, видалити акаунт не можу — пише кудись писати особисто».
             Тут була ПОДВІЙНА біда.
             По-перше, сама функція бази падала (див. міграцію 20260914090000):
             один рядок із 53 звертався до неіснуючої колонки, транзакція
             відкочувалась, edge віддавав 500.
             По-друге — ось це місце. supabase-js на БУДЬ-ЯКУ не-2xx відповідь
             віддає message «Edge Function returned a non-2xx status code», а
             старий фільтр ловив у ньому підрядок «edge function» і показував
             «сервіс недоступний, напишіть нам». Тобто справжня причина
             ховалась, і людина лишалась без жодного шляху вперед.
             Тепер спершу читаємо ТІЛО відповіді — там лежить справжня
             причина, — і лише коли тіла немає взагалі (мережа, функція не
             задеплоєна), кажемо «сервіс недоступний». */
          let raw = error?.message || (data as { error?: string } | null)?.error || "";
          const ctx = (error as unknown as { context?: unknown })?.context;
          if (ctx instanceof Response) {
            try {
              const body = await ctx.clone().json();
              if (body?.error) raw = String(body.error);
            } catch { /* тіла немає або воно не JSON — лишаємо message */ }
          }
          if (/failed to send|failed to fetch|networkerror|not found/i.test(raw)) {
            throw new Error(t("accountDeletion.serviceUnavailable"));
          }
          throw new Error(raw || t("accountDeletion.failed"));
        }
        toast.success(t("accountDeletion.done"), { description: t("accountDeletion.doneEmailFree") });
        try { await signOut(); } catch { /* сесія вже мертва — ок */ }
        navigate("/landing", { replace: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("accountDeletion.failed"), { description: msg });
        setBusy(false);
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderRadius: 16, border: "1px solid rgba(224,85,47,.3)", background: "rgba(224,85,47,.04)", padding: 14 }}>
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: "#b3441f" }}>
        {t("accountDeletion.title")}
      </div>
      <p style={{ fontSize: 14, color: "var(--sub,#62677E)", marginTop: 4, lineHeight: 1.5 }}>
        {t("accountDeletion.desc")}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 7, height: 44, padding: "0 16px", borderRadius: 12, cursor: "pointer", border: "1.5px solid rgba(224,85,47,.45)", background: "var(--ds-surface,#fff)", color: "#b3441f", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 15 }}
      >
        <Trash2 size={16} /> {t("accountDeletion.btn")}
      </button>

      <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accountDeletion.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("accountDeletion.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("accountDeletion.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); run(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("accountDeletion.confirmBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DeleteAccountSection;
