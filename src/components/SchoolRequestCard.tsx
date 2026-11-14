import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FIELD_CLASS, FieldLabel } from "@/components/form/canon";
import { FormSheet, SheetButton } from "@/components/form/FormSheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useHaptic } from "@/hooks/useHaptic";
import { logEvent } from "@/lib/analytics";

/**
 * «Керуєте школою?» — заявка на підключення школи з профілю (11.11).
 *
 * Школу підключає суперадмін за поштою вже зареєстрованої людини. Але людина про це
 * не знала: власниця школи реєструвалась, бачила кабінет самостійного репетитора і
 * жодного натяку, що школи тут узагалі бувають, — шлях починався з листування поза
 * застосунком. Тепер це один рядок у профілі: назва школи → заявка.
 *
 * Заявка лягає в наявну скриньку звернень (`feedback_submissions`), тож власниця
 * платформи отримує її в Telegram тим самим тригером, що й відгуки, і підключає
 * школу в адмінці «Школи» за поштою. Нової таблиці й нового каналу не заводимо.
 */
const SENT_KEY = "oth_school_request_sent";

export function SchoolRequestCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<boolean>(() => {
    try { return localStorage.getItem(SENT_KEY) === "1"; } catch { return false; }
  });

  const submit = async () => {
    const school = name.trim();
    if (!user || busy || school.length < 2) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("feedback_submissions").insert({
        user_id: user.id,
        category: "school_request",
        // текст для скриньки власниці платформи — завжди українською, якою б не була мова людини
        message: t(size.trim() ? "schoolRequest.inboxMessageSized" : "schoolRequest.inboxMessage", { lng: "uk", name: school, size: size.trim() }),
        contact: user.email ?? null,
        page_url: "/profile",
      });
      if (error) { toast.error(t("schoolRequest.failed")); return; }
      try { localStorage.setItem(SENT_KEY, "1"); } catch { /* приватний режим */ }
      setSent(true);
      setOpen(false);
      haptic.success();
      logEvent("school_requested");
      toast.success(t("schoolRequest.sentToast"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { if (!sent) setOpen(true); }}
        disabled={sent}
        className="mb-4 flex min-h-[64px] w-full items-center gap-3 rounded-[16px] border-[0.5px] border-[var(--border)] bg-card px-4 py-3 text-left"
      >
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-[20px]" style={{ background: "var(--teal-l)" }}>🏫</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-foreground">{t(sent ? "schoolRequest.sentTitle" : "schoolRequest.title")}</span>
          <span className="mt-0.5 block text-[14px] text-muted-foreground">{t(sent ? "schoolRequest.sentDesc" : "schoolRequest.desc")}</span>
        </span>
        {!sent && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
      </button>

      <FormSheet
        open={open}
        onOpenChange={setOpen}
        locked={busy}
        testId="school-request"
        title={t("schoolRequest.dialogTitle")}
        description={t("schoolRequest.dialogDesc")}
        footer={
          <SheetButton onClick={() => void submit()} disabled={busy || name.trim().length < 2}>
            {t(busy ? "schoolRequest.sending" : "schoolRequest.send")}
          </SheetButton>
        }
      >
        <div>
          <FieldLabel htmlFor="school-request-name">{t("schoolRequest.nameLabel")}</FieldLabel>
          <Input id="school-request-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
            placeholder={t("schoolRequest.namePlaceholder")} className={FIELD_CLASS} />
        </div>
        <div>
          <FieldLabel htmlFor="school-request-size">{t("schoolRequest.sizeLabel")}</FieldLabel>
          <Input id="school-request-size" value={size} onChange={(e) => setSize(e.target.value)} inputMode="numeric" maxLength={6}
            placeholder={t("schoolRequest.sizePlaceholder")} className={FIELD_CLASS} />
        </div>
        <p className="text-[14px] text-muted-foreground" style={{ lineHeight: 1.4 }}>{t("schoolRequest.note")}</p>
      </FormSheet>
    </>
  );
}
