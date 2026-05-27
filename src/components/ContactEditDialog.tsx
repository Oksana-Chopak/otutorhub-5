import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

export interface ContactFields {
  email: string | null;
  phone: string | null;
  telegram: string | null;
  messenger_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  // Financial fields moved to profile_financial_contacts table
  bank_card_last4?: string | null;
  bank_name?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  initial: ContactFields;
  onSaved?: () => void;
}

const empty: ContactFields = {
  email: "",
  phone: "",
  telegram: "",
  messenger_url: "",
  facebook_url: "",
  instagram_url: "",
  bank_card_last4: "",
  bank_name: "",
};

export function ContactEditDialog({ open, onOpenChange, userId, userName, initial, onSaved }: Props) {
  const [form, setForm] = useState<ContactFields>(empty);
  // Card input is held separately and only the last 4 digits are persisted.
  const [cardInput, setCardInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        email: initial.email ?? "",
        phone: initial.phone ?? "",
        telegram: initial.telegram ?? "",
        messenger_url: initial.messenger_url ?? "",
        facebook_url: initial.facebook_url ?? "",
        instagram_url: initial.instagram_url ?? "",
        bank_card_last4: initial.bank_card_last4 ?? "",
        bank_name: initial.bank_name ?? "",
      });
      setCardInput("");
    }
  }, [open, initial]);

  const setField = (k: keyof ContactFields, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const validateUrl = (url: string) => {
    if (!url) return true;
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };

  const save = async () => {
    const email = (form.email ?? "").trim().toLowerCase();
    const phone = (form.phone ?? "").trim();
    const telegram = (form.telegram ?? "").trim().replace(/^@/, "");
    const messenger_url = (form.messenger_url ?? "").trim();
    const facebook_url = (form.facebook_url ?? "").trim();
    const instagram_url = (form.instagram_url ?? "").trim();
    const bank_name = (form.bank_name ?? "").trim();

    // If user typed a new card, derive last4. Otherwise keep existing.
    let bank_card_last4 = (form.bank_card_last4 ?? "").trim();
    if (cardInput.trim()) {
      const digits = cardInput.replace(/\D/g, "");
      if (digits.length < 4 || digits.length > 19) {
        toast.error(t("contactEdit.cardInvalid"));
        return;
      }
      bank_card_last4 = digits.slice(-4);
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t("contactEdit.emailInvalid"));
      return;
    }
    for (const [label, val] of [
      ["Messenger", messenger_url],
      ["Facebook", facebook_url],
      ["Instagram", instagram_url],
    ] as const) {
      if (val && !validateUrl(val)) {
        toast.error(t("contactEdit.urlInvalid", { label }));
        return;
      }
    }
    if (bank_card_last4 && !/^\d{4}$/.test(bank_card_last4)) {
      toast.error(t("contactEdit.last4Invalid"));
      return;
    }

    setSaving(true);

    const contactPayload = {
      user_id: userId,
      email: email || null,
      phone: phone || null,
      telegram: telegram || null,
      messenger_url: messenger_url || null,
      facebook_url: facebook_url || null,
      instagram_url: instagram_url || null,
    };

    const financialPayload = {
      user_id: userId,
      bank_card_last4: bank_card_last4 || null,
      bank_name: bank_name || null,
    };

    // Перевіряємо живу сесію — інколи токен прострочений і fetch падає як "Load failed"
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setSaving(false);
      toast.error(t("contactEdit.sessionExpired"));
      return;
    }

    // Ретрай на випадок мережевих збоїв (Safari "Load failed", flaky network)
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Save regular contacts
        const { error: contactError } = await supabase
          .from("profile_contacts")
          .upsert(contactPayload, { onConflict: "user_id" });
        
        if (contactError) {
          lastError = contactError;
          break;
        }

        // Save financial contacts separately (only if provided)
        if (bank_card_last4 || bank_name) {
          const { error: financialError } = await supabase
            .from("profile_financial_contacts")
            .upsert(financialPayload, { onConflict: "user_id" });
          
          if (financialError) {
            lastError = financialError;
            break;
          }
        }

        // Both succeeded
        setSaving(false);
        toast.success(t("contactEdit.saved"));
        onOpenChange(false);
        onSaved?.();
        return;
      } catch (e) {
        lastError = e;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }

    setSaving(false);
    console.error("Failed to save contacts after retries", lastError);
    const msg = String(lastError?.message || "");
    if (/email/i.test(msg) && /(unique|duplicate)/i.test(msg)) {
      toast.error(t("contactEditExtra.emailDuplicate"));
    } else if (/load failed|network|fetch/i.test(msg)) {
      toast.error(t("contactEditExtra.networkError"));
    } else {
      toast.error(msg || t("contactEdit.saveFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("contactEditExtra.titleFormat", { name: userName })}</DialogTitle>
          <DialogDescription>
            Видимі тільки самій людині та менеджеру. Картка — для зручності виплат.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setField("email", e.target.value)}
                maxLength={255}
              />
            </div>
            <div>
              <Label htmlFor="c-phone">{t("contactEditExtra.phoneLabel")}</Label>
              <Input
                id="c-phone"
                type="tel"
                value={form.phone ?? ""}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="+380..."
                maxLength={32}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="c-tg">{t("contactEditExtra.telegramLabel")}</Label>
            <Input
              id="c-tg"
              value={form.telegram ?? ""}
              onChange={(e) => setField("telegram", e.target.value)}
              placeholder="@username"
              maxLength={64}
            />
          </div>
          <div>
            <Label htmlFor="c-msg">{t("contactEditExtra.messengerLabel")}</Label>
            <Input
              id="c-msg"
              type="url"
              value={form.messenger_url ?? ""}
              onChange={(e) => setField("messenger_url", e.target.value)}
              placeholder="https://m.me/..."
              maxLength={500}
            />
          </div>
          <div>
            <Label htmlFor="c-fb">Facebook</Label>
            <Input
              id="c-fb"
              type="url"
              value={form.facebook_url ?? ""}
              onChange={(e) => setField("facebook_url", e.target.value)}
              placeholder="https://facebook.com/..."
              maxLength={500}
            />
          </div>
          <div>
            <Label htmlFor="c-ig">Instagram</Label>
            <Input
              id="c-ig"
              type="url"
              value={form.instagram_url ?? ""}
              onChange={(e) => setField("instagram_url", e.target.value)}
              placeholder="https://instagram.com/..."
              maxLength={500}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-bank">{t("contactEditExtra.bankLabel")}</Label>
              <Input
                id="c-bank"
                value={form.bank_name ?? ""}
                onChange={(e) => setField("bank_name", e.target.value)}
                placeholder={t("contactEditExtra.bankPlaceholder")}
                maxLength={64}
              />
            </div>
            <div>
              <Label htmlFor="c-card">{t("contactEditExtra.cardLabel")}</Label>
              <Input
                id="c-card"
                value={cardInput}
                onChange={(e) => setCardInput(e.target.value)}
                placeholder={form.bank_card_last4 ? `•••• ${form.bank_card_last4}` : "0000 0000 0000 0000"}
                maxLength={25}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            З міркувань безпеки зберігаємо лише останні 4 цифри картки. Повний номер не зберігається.
          </p>
        </div>
        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-0">
          <Button variant="outline" className="h-11 rounded-[12px] border-[0.5px]" onClick={() => onOpenChange(false)} disabled={saving}>
            Скасувати
          </Button>
          <Button onClick={save} disabled={saving} className="h-11 w-full rounded-[12px] text-[15px] font-semibold sm:w-auto" style={{background:"var(--teal,#2BBFAA)",color:"#fff"}}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Зберегти
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
