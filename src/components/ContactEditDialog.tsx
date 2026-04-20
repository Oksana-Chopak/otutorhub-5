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

export interface ContactFields {
  email: string | null;
  phone: string | null;
  telegram: string | null;
  messenger_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  bank_card: string | null;
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
  bank_card: "",
};

export function ContactEditDialog({ open, onOpenChange, userId, userName, initial, onSaved }: Props) {
  const [form, setForm] = useState<ContactFields>(empty);
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
        bank_card: initial.bank_card ?? "",
      });
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
    const bank_card = (form.bank_card ?? "").trim();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Невірний email");
      return;
    }
    for (const [label, val] of [
      ["Messenger", messenger_url],
      ["Facebook", facebook_url],
      ["Instagram", instagram_url],
    ] as const) {
      if (val && !validateUrl(val)) {
        toast.error(`${label}: вкажіть повний URL (https://...)`);
        return;
      }
    }
    if (bank_card && !/^[\d\s-]{12,25}$/.test(bank_card)) {
      toast.error("Номер картки виглядає некоректно");
      return;
    }

    setSaving(true);

    const payload = {
      user_id: userId,
      email: email || null,
      phone: phone || null,
      telegram: telegram || null,
      messenger_url: messenger_url || null,
      facebook_url: facebook_url || null,
      instagram_url: instagram_url || null,
      bank_card: bank_card || null,
    };

    // Перевіряємо живу сесію — інколи токен прострочений і fetch падає як "Load failed"
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setSaving(false);
      toast.error("Сесія завершилась. Оновіть сторінку та увійдіть знову.");
      return;
    }

    // Ретрай на випадок мережевих збоїв (Safari "Load failed", flaky network)
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error } = await supabase
          .from("profile_contacts")
          .upsert(payload, { onConflict: "user_id" });
        if (!error) {
          setSaving(false);
          toast.success("Контакти збережено");
          onOpenChange(false);
          onSaved?.();
          return;
        }
        lastError = error;
        const msg = String(error.message || "").toLowerCase();
        // Не ретраїмо помилки валідації / RLS / унікальності
        if (
          msg.includes("duplicate") ||
          msg.includes("unique") ||
          msg.includes("violates") ||
          msg.includes("permission") ||
          msg.includes("rls") ||
          msg.includes("policy")
        ) {
          break;
        }
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
      toast.error("Цей email вже використовується іншою людиною");
    } else if (/load failed|network|fetch/i.test(msg)) {
      toast.error("Проблема з мережею. Перевірте з'єднання та спробуйте ще раз.");
    } else {
      toast.error(msg || "Не вдалося зберегти контакти");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Контакти: {userName}</DialogTitle>
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
              <Label htmlFor="c-phone">Телефон</Label>
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
            <Label htmlFor="c-tg">Telegram (нік)</Label>
            <Input
              id="c-tg"
              value={form.telegram ?? ""}
              onChange={(e) => setField("telegram", e.target.value)}
              placeholder="@username"
              maxLength={64}
            />
          </div>
          <div>
            <Label htmlFor="c-msg">Messenger (посилання)</Label>
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
          <div>
            <Label htmlFor="c-card">Номер банківської картки</Label>
            <Input
              id="c-card"
              value={form.bank_card ?? ""}
              onChange={(e) => setField("bank_card", e.target.value)}
              placeholder="0000 0000 0000 0000"
              maxLength={25}
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Зберігається в захищеній базі. Бачить власник і менеджер.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Скасувати
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Зберегти
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
