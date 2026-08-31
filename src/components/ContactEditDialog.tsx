import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, X, Mail, Phone, Send, MessageCircle, Facebook, Instagram,
  Landmark, CreditCard, ShieldCheck,
} from "lucide-react";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

/** One labelled input with a leading icon — the DS field shape used across the form. */
function Field({
  icon: Icon, label, htmlFor, children,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[14px] font-medium text-[#666b82]">{label}</Label>
      <div className="relative">
        <Icon size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sub,#666b82)]" />
        {children}
      </div>
    </div>
  );
}

/** A titled group of fields with the DS section label. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="text-[14px] font-bold uppercase tracking-[0.08em] text-[var(--sub,#666b82)]">{label}</div>
      {children}
    </section>
  );
}

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
      <DialogContent className="max-w-md p-0 gap-0 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto max-h-[92vh] flex flex-col [&>button.absolute]:hidden">
        {/* C3: VoiceOver казав просто «діалог» — тепер діалог названо */}
        <DialogTitle className="sr-only">{t("contactEditExtra.titleFormat", { name: userName })}</DialogTitle>
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(15,15,26,.14)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 20px 10px", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-.01em", color: "#0f0f1a" }}>
              {t("contactEditExtra.titleFormat", { name: userName })}
            </div>
            <div style={{ fontSize: 14, color: "var(--sub,#666b82)", marginTop: 2, lineHeight: 1.4 }}>
              {t("contactEdit.visibilityHint")}
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="✕"
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, border: "none", background: "#F5F4F0", color: "var(--sub,#666b82)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 20px 16px" }}>
        <div className="space-y-5 py-2">
          <Section label={t("contactEditExtra.sectionContacts")}>
            <Field icon={Mail} label="Email" htmlFor="c-email">
              <Input id="c-email" type="email" className="pl-10" placeholder="name@email.com"
                value={form.email ?? ""} onChange={(e) => setField("email", e.target.value)} maxLength={255} />
            </Field>
            <Field icon={Phone} label={t("contactEditExtra.phoneLabel")} htmlFor="c-phone">
              <Input id="c-phone" type="tel" className="pl-10" placeholder="+380..."
                value={form.phone ?? ""} onChange={(e) => setField("phone", e.target.value)} maxLength={32} />
            </Field>
            <Field icon={Send} label={t("contactEditExtra.telegramLabel")} htmlFor="c-tg">
              <Input id="c-tg" className="pl-10" placeholder="@username"
                value={form.telegram ?? ""} onChange={(e) => setField("telegram", e.target.value)} maxLength={64} />
            </Field>
          </Section>

          <Section label={t("contactEditExtra.sectionSocial")}>
            <Field icon={MessageCircle} label={t("contactEditExtra.messengerLabel")} htmlFor="c-msg">
              <Input id="c-msg" type="url" className="pl-10" placeholder="https://m.me/..."
                value={form.messenger_url ?? ""} onChange={(e) => setField("messenger_url", e.target.value)} maxLength={500} />
            </Field>
            <Field icon={Facebook} label="Facebook" htmlFor="c-fb">
              <Input id="c-fb" type="url" className="pl-10" placeholder="https://facebook.com/..."
                value={form.facebook_url ?? ""} onChange={(e) => setField("facebook_url", e.target.value)} maxLength={500} />
            </Field>
            <Field icon={Instagram} label="Instagram" htmlFor="c-ig">
              <Input id="c-ig" type="url" className="pl-10" placeholder="https://instagram.com/..."
                value={form.instagram_url ?? ""} onChange={(e) => setField("instagram_url", e.target.value)} maxLength={500} />
            </Field>
          </Section>

          <Section label={t("contactEditExtra.sectionPayout")}>
            <Field icon={Landmark} label={t("contactEditExtra.bankLabel")} htmlFor="c-bank">
              <Input id="c-bank" className="pl-10" placeholder={t("contactEditExtra.bankPlaceholder")}
                value={form.bank_name ?? ""} onChange={(e) => setField("bank_name", e.target.value)} maxLength={64} />
            </Field>
            <Field icon={CreditCard} label={t("contactEditExtra.cardLabel")} htmlFor="c-card">
              <Input id="c-card" className="pl-10" inputMode="numeric" autoComplete="off" maxLength={25}
                placeholder={form.bank_card_last4 ? `•••• ${form.bank_card_last4}` : "0000 0000 0000 0000"}
                value={cardInput} onChange={(e) => setCardInput(e.target.value)} />
            </Field>
            <div className="flex items-start gap-2 rounded-[12px] bg-[#F5F4F0] px-3 py-2.5">
              <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-[var(--sub,#666b82)]" />
              <p className="text-[14px] leading-snug text-[#666b82]">{t("contactEditExtra.securityNote")}</p>
            </div>
          </Section>
        </div>
        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-0">
          <Button variant="outline" className="h-11 rounded-[12px] border-[0.5px]" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving} className="h-[50px] w-full rounded-[14px] text-[16px] font-semibold sm:w-auto" style={{background:"var(--teal,#2BBFAA)",color:"#0f0f1a"}}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
