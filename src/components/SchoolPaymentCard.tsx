import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useHaptic } from "@/hooks/useHaptic";
import { Textarea } from "@/components/ui/textarea";
import { AREA_CLASS, FieldLabel } from "@/components/form/canon";
import { logEvent } from "@/lib/analytics";

/** Стеля поля — та сама, що й у базі (`hubs_payment_details_len`). */
export const SCHOOL_PAYMENT_DETAILS_MAX = 600;

/**
 * «Реквізити для оплати» в профілі менеджера школи (21.11, рішення власниці п. 5).
 *
 * Учень школи бачив борг, але не бачив, КУДИ платити: реквізити жили лише на парі
 * «учень — репетитор», а їх заповнює самостійний репетитор у «Моїх учнях». У школи —
 * одне поле на всю школу. Після збереження його бачать учні школи в «Оплатах» і батьки
 * на сторінці оплати за посиланням (`/p/<код>`); у нагадуванні зникає «реквізитів немає».
 *
 * Усе — через функції бази (`my_hub_payment_details`, `set_my_hub_payment_details`):
 * поки їх немає (SQL ще не вставлено) або людина не менеджер школи, картки немає —
 * поле, яке не можна зберегти, гірше за його відсутність.
 */
export function SchoolPaymentCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (supabase.rpc as any)("my_hub_payment_details").then(({ data, error }: { data: string | null; error: unknown }) => {
      if (!alive || error) return;
      setSaved(data ?? "");
      setValue(data ?? "");
      setReady(true);
    });
    return () => { alive = false; };
  }, [user?.id]);

  if (!ready) return null;

  const dirty = value.trim() !== (saved ?? "").trim();

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("set_my_hub_payment_details", { _details: value });
      if (error) { haptic.error(); toast.error(t("schoolPayCard.failed")); return; }
      const next = (data as string | null) ?? "";
      setSaved(next);
      setValue(next);
      haptic.success();
      if (next) logEvent("school_payment_details_set");
      toast.success(t(next ? "schoolPayCard.saved" : "schoolPayCard.cleared"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="school-payment" aria-label={t("schoolPayCard.title")}
      className="mb-4 rounded-[16px] border-[0.5px] border-[var(--border)] bg-card p-4">
      <h2 className="text-[17px] font-extrabold text-foreground">💳 {t("schoolPayCard.title")}</h2>
      <p className="mt-1 text-[14px] text-muted-foreground" style={{ lineHeight: 1.4 }}>
        {t(saved ? "schoolPayCard.descSet" : "schoolPayCard.descEmpty")}
      </p>
      <div className="mt-3">
        <FieldLabel htmlFor="school-payment-details">{t("schoolPayCard.label")}</FieldLabel>
        <Textarea
          id="school-payment-details"
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, SCHOOL_PAYMENT_DETAILS_MAX))}
          maxLength={SCHOOL_PAYMENT_DETAILS_MAX}
          placeholder={t("schoolPayCard.placeholder")}
          className={AREA_CLASS}
        />
      </div>
      <button type="button" onClick={() => void save()} disabled={busy || !dirty}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[13px] text-[15px] font-bold disabled:opacity-50"
        style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", border: "none", cursor: busy || !dirty ? "default" : "pointer" }}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {t("schoolPayCard.save")}
      </button>
    </section>
  );
}
