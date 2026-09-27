import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Вікно звʼязку на лендінгу для НЕзареєстрованих (рішення власниці 27.09).
 *
 * Чому воно потрібне окремо від Telegram: єдиним контактом до 27.09 був
 * Telegram, тож людина без нього (або та, що не хоче писати в особисті) не мала
 * способу спитати нічого. Питання до реєстрації без відповіді — це людина, яка
 * просто пішла.
 *
 * Пише в ТУ САМУ скриньку звернень, що й форма всередині застосунку
 * (`feedback_submissions`), тобто відповідати можна звідти ж, де й на решту —
 * RPC `answer_feedback` уже вміє це з 26.09. Анонімному сповіщення в дзвіночок
 * не піде, тому просимо контакт: без нього відповідь нікуди надіслати.
 */
export function LandingContactDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const msg = message.trim();
    if (msg.length < 3) {
      toast.error(t("landingContact.tooShort"));
      return;
    }
    setSending(true);
    try {
      // Каст: типи RPC регенеруються після застосування міграції.
      const { error } = await (supabase.rpc as any)("submit_landing_feedback", {
        _message: msg,
        _contact: contact.trim() || null,
        _page_url: window.location.pathname,
      });
      if (error) {
        const raw = String(error.message ?? "");
        toast.error(
          raw.includes("RATE_LIMITED") ? t("landingContact.rateLimited") : t("landingContact.failed"),
        );
        return;
      }
      // «Надіслано» пишемо ЛИШЕ після відповіді бази — святкуємо збережене.
      setSent(true);
      setMessage("");
      setContact("");
    } finally {
      // Без finally кинутий виняток лишив би кнопку заблокованою назавжди.
      setSending(false);
    }
  };

  const close = () => {
    onOpenChange(false);
    setSent(false);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: 12, border: "1px solid var(--ds-border,#eceef3)",
    padding: "11px 13px", fontSize: 15, background: "var(--ds-surface,#fff)",
    color: "var(--ds-txt,#0f0f1a)", fontFamily: "'Golos Text', Inter, system-ui, sans-serif",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      {/* Канон форм: на телефоні — аркуш знизу, на десктопі — центр. */}
      <DialogContent className="sm:max-w-md rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[90vh] overflow-y-auto">
        <DialogTitle style={{ fontSize: 19, fontWeight: 800 }}>{t("landingContact.title")}</DialogTitle>
        <DialogDescription style={{ fontSize: 15 }}>
          {sent ? t("landingContact.sentDesc") : t("landingContact.subtitle")}
        </DialogDescription>

        {sent ? (
          <div style={{ padding: "8px 0 4px" }}>
            <div style={{ fontSize: 40, lineHeight: 1 }}>💛</div>
            <button
              type="button"
              onClick={close}
              className="mt-4 h-11 w-full rounded-[12px] bg-[var(--teal)] text-[15px] font-semibold text-white"
            >
              {t("common.close")}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--sub,#62677E)" }}>
                {t("landingContact.messageLabel")}
              </span>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={4000}
                placeholder={t("landingContact.messagePlaceholder")}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--sub,#62677E)" }}>
                {t("landingContact.contactLabel")}
              </span>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={200}
                placeholder={t("landingContact.contactPlaceholder")}
                style={inputStyle}
              />
              <span style={{ fontSize: 13, color: "var(--sub,#62677E)" }}>
                {t("landingContact.contactHint")}
              </span>
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--teal)] text-[15px] font-semibold text-white disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("landingContact.send")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
